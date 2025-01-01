// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (error) {
    console.log('No .env file found, using environment variables from the system');
}

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Configure CORS with environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000', 'https://st-backend-8j0f.onrender.com'];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Store cookies and last request time
let cookies = '';
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // Minimum 1 second between requests

// Required headers for NSE API
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.nseindia.com',
    'Connection': 'keep-alive'
};

// Function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to ensure minimum time between requests
async function throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await delay(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
    lastRequestTime = Date.now();
}

// Function to get cookies with retry logic
async function getCookies(retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            await throttleRequest();
            
            const response = await axios.get('https://www.nseindia.com', {
                headers: headers,
                timeout: 5000,
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 303; // Accept only success and redirect status codes
                }
            });

            if (response.headers['set-cookie']) {
                return response.headers['set-cookie'];
            }
            throw new Error('No cookies received');
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error;
            await delay(backoff * Math.pow(2, i)); // Exponential backoff
        }
    }
}

// Middleware to refresh cookies
async function refreshCookies(req, res, next) {
    try {
        if (!cookies) {
            cookies = await getCookies();
        }
        next();
    } catch (error) {
        console.error('Error refreshing cookies:', error);
        // Clear cookies on error to force a refresh on next attempt
        cookies = '';
        res.status(503).json({ 
            error: 'Service temporarily unavailable',
            message: 'Failed to connect to NSE. Please try again in a few moments.'
        });
    }
}

app.use(refreshCookies);

// Proxy endpoint for NIFTY 50 data
app.get('/api/nifty50', async (req, res) => {
    try {
        await throttleRequest();
        
        const response = await axios.get(
            'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050',
            {
                headers: {
                    ...headers,
                    'Cookie': cookies.join('; ')
                }
            }
        );
        console.log('NSE API Response:', response.data);
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching data:', error);
        // If cookie expired, clear it so it will be refreshed
        if (error.response && error.response.status === 403) {
            cookies = '';
        }
        res.status(500).json({ error: 'Failed to fetch data from NSE' });
    }
});

// Proxy endpoint for stock details
app.get('/api/stock/:symbol', async (req, res) => {
    try {
        // First get the quote data
        await throttleRequest();
        
        const quoteResponse = await axios.get(
            `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(req.params.symbol)}`,
            {
                headers: {
                    ...headers,
                    'Cookie': cookies.join('; ')
                }
            }
        );

        // Then get the trade info data which has more detailed volume information
        await throttleRequest();
        
        const tradeInfoResponse = await axios.get(
            `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(req.params.symbol)}&section=trade_info`,
            {
                headers: {
                    ...headers,
                    'Cookie': cookies.join('; ')
                }
            }
        );

        // Combine the data
        const combinedData = {
            ...quoteResponse.data,
            tradeInfo: tradeInfoResponse.data
        };

        res.json(combinedData);
    } catch (error) {
        console.error('Error fetching stock details:', error);
        // If cookie expired, clear it so it will be refreshed
        if (error.response && error.response.status === 403) {
            cookies = '';
        }
        res.status(500).json({ error: 'Failed to fetch stock details' });
    }
});

// Test endpoint for Vercel deployment
app.get('/', (req, res) => {
    res.json({ message: 'Hello from Vercel Server!' });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
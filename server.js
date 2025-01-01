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
    : ['http://localhost:3000', 'https://stock-data-eight.vercel.app'];

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

// Store cookies
let cookies = '';

// Required headers for NSE API
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.nseindia.com',
};

// Function to get cookies
async function getCookies() {
    try {
        const response = await axios.get('https://www.nseindia.com', {
            headers: headers
        });
        return response.headers['set-cookie'];
    } catch (error) {
        console.error('Error getting cookies:', error);
        throw error;
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
        res.status(500).json({ error: 'Failed to refresh cookies' });
    }
}

app.use(refreshCookies);

// Proxy endpoint for NIFTY 50 data
app.get('/api/nifty50', async (req, res) => {
    try {
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
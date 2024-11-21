const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { scrapeOtodom } = require('./scrapers/otodom');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
 useNewUrlParser: true,
 useUnifiedTopology: true
});

const Property = mongoose.model('Property', {
 title: String,
 price: { type: Number, default: null },
 area: { type: Number, default: null },
 rooms: { type: Number, default: null },
 location: { type: String, default: '' },
 description: { type: String, default: '' },
 status: { 
   type: String, 
   enum: ['wybierz', 'do zamieszkania', 'do remontu', 'w budowie', 'stan deweloperski'],
   default: 'wybierz'
 },
 rating: { 
   type: String, 
   enum: ['favorite', 'interested', 'not_interested', null],
   default: null 
 },
 details: { type: Object, default: {} },
 source: String,
 sourceUrl: String,
 edited: { type: Boolean

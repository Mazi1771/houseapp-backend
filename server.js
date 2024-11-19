// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { scrapeOtodom } = require('./scrapers/otodom');

const app = express();

app.use(cors());
app.use(express.json());

// Połączenie z MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Model dla ogłoszenia
const Property = mongoose.model('Property', {
  title: String,
  price: Number,
  area: Number,
  rooms: Number,
  location: String,
  description: String,
  details: Object,
  source: String,
  sourceUrl: String,
  createdAt: { type: Date, default: Date.now }
});

// Endpoint do scrapowania
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'Obecnie obsługujemy tylko otodom.pl' });
    }

    const scrapedData = await scrapeOtodom(url);
    
    // Zapisz w bazie danych
    const property = new Property({
      ...scrapedData,
      sourceUrl: url
    });
    
    await property.save();
    
    res.json(property);
  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint do pobierania zapisanych ogłoszeń
app.get('/api/properties', async (req, res) => {
  try {
    const properties = await Property.find().sort({ createdAt: -1 });
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});

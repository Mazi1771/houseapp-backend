// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { scrapeOtodom } = require('./scrapers/otodom');
// Konfiguracja Puppeteer dla Render.com
const puppeteerConfig = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ],
  headless: "new",
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
};
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
  price: { type: Number, default: null },
  area: { type: Number, default: null },
  rooms: { type: Number, default: null },
  location: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['do zamieszkania', 'do remontu', 'w budowie', 'stan deweloperski'],
    default: 'stan deweloperski'
  },
  details: { type: Object, default: {} },
  source: String,
  sourceUrl: String,
  edited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Endpoint do scrapowania
app.get('/', (req, res) => {
  res.json({ message: 'API działa!' });
});
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
// Endpoint testowy z przykładowym URL
app.get('/test-scrape', async (req, res) => {
  try {
    const testUrl = 'https://www.otodom.pl/pl/oferta/3-pokojowe-mieszkanie-52m2-ogrodek-bez-prowizji-ID4rB82';
    const scrapedData = await scrapeOtodom(testUrl);
    res.json(scrapedData);
  } catch (error) {
    console.error('Błąd podczas testowego scrapowania:', error);
    res.status(500).json({ error: error.message });
  }
});
// Endpoint do aktualizacji ogłoszenia
app.put('/api/properties/:id', async (req, res) => {
  try {
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      { ...req.body, edited: true, updatedAt: new Date() },
      { new: true }
    );
    res.json(property);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});
// Endpoint do usuwania ogłoszenia
app.delete('/api/properties/:id', async (req, res) => {
  try {
    await Property.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Ogłoszenie zostało usunięte' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

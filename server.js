const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Schemat użytkownika
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  boards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  }],
  createdAt: { type: Date, default: Date.now }
});

// Schemat tablicy
const BoardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shared: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['viewer', 'editor'],
      default: 'viewer'
    }
  }],
  properties: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  }],
  isPrivate: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Schemat nieruchomości
const PropertySchema = new mongoose.Schema({
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
  board: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true
  },
  edited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Board = mongoose.model('Board', BoardSchema);
const Property = mongoose.model('Property', PropertySchema);

// Middleware autoryzacji
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded.userId });

    if (!user) {
      throw new Error();
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Proszę się zalogować' });
  }
};

// Funkcja scrapująca
async function scrapeOtodom(url) {
  try {
    console.log('Rozpoczynam scrapowanie:', url);
    
    const scrapingApiKey = process.env.SCRAPING_API_KEY;
    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `http://api.scraperapi.com?api_key=${scrapingApiKey}&url=${encodedUrl}&render=true`;

    console.log('Wysyłam request do ScraperAPI');
    const response = await axios.get(apiUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    console.log('HTML pobrany, długość:', html.length);
    console.log('Szukam elementów...');

    const title = $('[data-cy="adPageHeader"]').text().trim() || $('h1').first().text().trim();
    console.log('Znaleziony tytuł:', title);

    const priceText = $('[aria-label="Cena"]').first().text().trim() || 
                     $('[data-cy="adPageHeaderPrice"]').first().text().trim();
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;
    console.log('Znaleziona cena:', price);

    const areaText = $('[aria-label="Powierzchnia"]').first().text().trim() ||
                    $('div:contains("Powierzchnia")').next().text().trim();
    const area = areaText ? parseFloat(areaText.match(/[\d.,]+/)[0].replace(',', '.')) : null;
    console.log('Znaleziona powierzchnia:', area);

    const roomsText = $('[aria-label="Liczba pokoi"]').first().text().trim() ||
                     $('div:contains("Liczba pokoi")').next().text().trim();
    const rooms = roomsText ? parseInt(roomsText.match(/\d+/)[0]) : null;
    console.log('Znaleziona liczba pokoi:', rooms);

    const location = $('[aria-label="Adres"]').first().text().trim() ||
                    $('[data-cy="adPageHeaderLocation"]').first().text().trim();
    console.log('Znaleziona lokalizacja:', location);

    const description = $('[data-cy="adPageDescription"]').first().text().trim() ||
                       $('.eo9qioj1').first().text().trim();
    console.log('Znaleziony opis:', description ? description.substring(0, 100) + '...' : 'brak');

    const result = {
      title,
      price,
      area,
      rooms,
      location,
      description,
      sourceUrl: url,
      source: 'otodom'
    };

    console.log('Scrapowanie zakończone sukcesem:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error.message);
    console.error('Stack trace:', error.stack);
    throw new Error(`Nie udało się pobrać danych z Otodom: ${error.message}`);
  }
}

// Endpointy

// Test API
app.get('/', (req, res) => {
  res.json({ message: 'API działa!' });
});

// Rejestracja
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      email,
      password: hashedPassword,
      name
    });

    await user.save();

    const defaultBoard = new Board({
      name: 'Moja tablica',
      owner: user._id,
      isPrivate: true
    });

    await defaultBoard.save();

    user.boards.push(defaultBoard._id);
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logowanie
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scraping
app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || !url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'Nieprawidłowy URL. Musi być z serwisu Otodom.' });
    }

    const defaultBoard = await Board.findOne({ owner: req.user._id });
    if (!defaultBoard) {
      return res.status(404).json({ error: 'Nie znaleziono domyślnej tablicy' });
    }

    console.log('Rozpoczynam scrapowanie URL:', url);
    const scrapedData = await scrapeOtodom(url);
    console.log('Pobrane dane:', scrapedData);

    const property = new Property({
      ...scrapedData,
      board: defaultBoard._id,
      status: 'wybierz'
    });

    await property.save();
    defaultBoard.properties.push(property._id);
    await defaultBoard.save();

    res.json(property);
  } catch (error) {
    console.error('Błąd w endpoincie /api/scrape:', error);
    res.status(500).json({
      error: 'Wystąpił błąd podczas pobierania danych',
      details: error.message
    });
  }
});

// Pobieranie właściwości
app.get('/api/properties', auth, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id }
      ]
    });

    const boardIds = boards.map(board => board._id);
    const properties = await Property.find({ board: { $in: boardIds } });
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aktualizacja właściwości
app.put('/api/properties/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOneAndUpdate(
      {
        _id: req.params.id,
        board: { $in: req.user.boards }
      },
      {
        ...req.body,
        updatedAt: Date.now(),
        edited: true
      },
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    res.json(property);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Usuwanie właściwości
app.delete('/api/properties/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    await Board.updateOne(
      { _id: property.board },
      { $pull: { properties: property._id } }
    );

    await Property.deleteOne({ _id: req.params.id });
    res.json({ message: 'Nieruchomość została usunięta' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});
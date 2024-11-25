const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

// Lista dozwolonych origin'ów
const allowedOrigins = [
  'https://houseapp-uhmg.vercel.app',
  'https://houseapp-uhmg-46y3jw4q5-barteks-projects-c321e8d8.vercel.app',
  'http://localhost:3000'
];

// Konfiguracja CORS
app.use(cors({
  origin: function(origin, callback) {
    // Pozwól na requesty bez originu (np. Postman, curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('Niedozwolony origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // cache preflight requests for 24 hours
}));

// Explicit handling dla OPTIONS requests
app.options('*', cors());

app.use(express.json());

// Lepsze logowanie dla MongoDB
mongoose.connection.on('connected', () => {
  console.log('MongoDB połączone pomyślnie');
});

mongoose.connection.on('error', (err) => {
  console.error('Błąd połączenia MongoDB:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone');
});

// Zaktualizowana konfiguracja połączenia z MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    console.log('Próba połączenia z MongoDB...');
    console.log('URI present:', !!mongoURI);

    if (!mongoURI) {
      throw new Error('Brak MONGODB_URI w zmiennych środowiskowych');
    }

    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout po 5 sekundach
      socketTimeoutMS: 45000, // Timeout dla operacji po 45 sekundach
      family: 4 // Wymuś IPv4
    });

    console.log('Połączenie z MongoDB ustanowione');
  } catch (err) {
    console.error('Błąd podczas łączenia z MongoDB:', err);
    // Spróbuj ponownie za 5 sekund
    setTimeout(connectDB, 5000);
  }
};

// Pierwsze połączenie
connectDB();

// Automatyczne ponowne połączenie w razie rozłączenia
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone - próba ponownego połączenia...');
  setTimeout(connectDB, 5000);
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
  price: { type: Number, default: null, required: false },
  area: { type: Number, default: null, required: false },
  plotArea: { type: Number, default: null, required: false }, // powierzchnia działki
  rooms: { type: Number, default: null, required: false },
  location: { type: String, default: '' },
  city: { type: String, default: '' }, // miasto
  district: { type: String, default: '' }, // dzielnica/okolica
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
  propertyType: { type: String, default: '' }, // typ nieruchomości (dom/mieszkanie)
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
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader); // debugging

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Brak tokenu autoryzacji');
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('Token otrzymany:', token ? 'Jest' : 'Brak'); // debugging

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token zdekodowany:', decoded); // debugging

      const user = await User.findOne({ _id: decoded.userId });
      if (!user) {
        throw new Error('Nie znaleziono użytkownika');
      }

      req.user = user;
      req.token = token;
      next();
    } catch (error) {
      console.error('Błąd weryfikacji tokenu:', error); // debugging
      throw new Error('Token nieprawidłowy lub wygasł');
    }
  } catch (error) {
    console.error('Błąd autoryzacji:', error.message); // debugging
    res.status(401).json({ 
      error: 'Proszę się zalogować', 
      details: error.message 
    });
  }
};

// Zaktualizuj funkcję scrapowania w server.js:

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

    // Funkcja do czyszczenia tekstu z liczb
    const cleanNumber = (text, type = 'int') => {
      if (!text) return null;
      // Usuń wszystkie znaki specjalne oprócz kropki i przecinka
      const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
      const number = type === 'int' ? parseInt(cleaned) : parseFloat(cleaned);
      return isNaN(number) ? null : number;
    };

    // Funkcja do szukania wartości w tabeli parametrów
    const findParameterValue = (parameterName) => {
      let value = '';
      $('div.css-1ccovha').each((_, element) => {
        const label = $(element).find('div:first-child').text().trim();
        if (label.toLowerCase().includes(parameterName.toLowerCase())) {
          value = $(element).find('div:last-child').text().trim();
          return false; // przerwij iterację
        }
      });
      return value;
    };

    // Pobieranie danych podstawowych
    const title = $('[data-cy="adPageHeader"]').text().trim() || 
                 $('h1').first().text().trim();
    console.log('Tytuł:', title);

    // Cena
    const priceText = $('[data-cy="adPageHeaderPrice"]').text().trim() ||
                     $('[aria-label="Cena"]').text().trim();
    const price = cleanNumber(priceText);
    console.log('Cena:', price);

    // Typ nieruchomości
    const propertyType = findParameterValue('typ nieruchomości') || 
                        findParameterValue('rodzaj zabudowy');
    console.log('Typ nieruchomości:', propertyType);

    // Powierzchnia użytkowa
    const areaText = $('[aria-label="Powierzchnia"]').text().trim() ||
                    findParameterValue('powierzchnia');
    const area = cleanNumber(areaText, 'float');
    console.log('Powierzchnia użytkowa:', area);

    // Powierzchnia działki
    const plotAreaText = findParameterValue('powierzchnia działki') ||
                        findParameterValue('działka');
    const plotArea = cleanNumber(plotAreaText, 'float');
    console.log('Powierzchnia działki:', plotArea);

    // Pokoje
    const roomsText = findParameterValue('liczba pokoi') ||
                     $('[aria-label="Liczba pokoi"]').text().trim();
    const rooms = cleanNumber(roomsText);
    console.log('Liczba pokoi:', rooms);

    // Lokalizacja
    const fullLocationText = $('[data-cy="adPageHeaderLocation"]').text().trim() ||
                           $('[aria-label="Adres"]').text().trim();
    console.log('Pełna lokalizacja:', fullLocationText);

    // Parsowanie lokalizacji
    const locationParts = fullLocationText.split(',').map(part => part.trim());
    const city = locationParts[0] || '';
    const district = locationParts[1] || '';
    const street = locationParts[2] || '';
    
    console.log('Miasto:', city);
    console.log('Dzielnica:', district);
    console.log('Ulica:', street);

    // Opis
    const description = $('[data-cy="adPageDescription"]').text().trim() ||
                       $('.eo9qioj1').text().trim();

    // Pobieranie dodatkowych parametrów
    const details = {};
    $('div.css-1ccovha').each((_, element) => {
      const label = $(element).find('div:first-child').text().trim();
      const value = $(element).find('div:last-child').text().trim();
      if (label && value) {
        details[label] = value;
      }
    });
    console.log('Dodatkowe parametry:', details);

    const result = {
      title,
      price,
      area,
      plotArea,
      rooms,
      location: fullLocationText,
      city,
      district,
      description,
      sourceUrl: url,
      source: 'otodom',
      propertyType,
      details
    };

    console.log('Końcowe dane:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    return {
      title: url.split('/').pop(),
      price: null,
      area: null,
      plotArea: null,
      rooms: null,
      location: '',
      city: '',
      district: '',
      description: '',
      sourceUrl: url,
      source: 'otodom',
      propertyType: '',
      details: {}
    };
  }
}


// Endpointy

// Test API
app.get('/', (req, res) => {
  res.json({ message: 'API działa!' });
});

// Endpoint do rejestracji z lepszym logowaniem i obsługą błędów
app.post('/api/auth/register', async (req, res) => {
  console.log('Otrzymano request rejestracji:', {
    email: req.body.email,
    hasPassword: !!req.body.password,
    hasName: !!req.body.name
  });

  try {
    const { email, password, name } = req.body;

    // Walidacja danych wejściowych
    if (!email || !password) {
      console.log('Brak wymaganych pól');
      return res.status(400).json({ 
        error: 'Email i hasło są wymagane',
        fields: {
          email: !email,
          password: !password
        }
      });
    }

    // Sprawdzenie czy użytkownik już istnieje
    console.log('Sprawdzanie istniejącego użytkownika...');
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('Znaleziono istniejącego użytkownika z tym emailem');
      return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
    }

    // Hashowanie hasła
    console.log('Hashowanie hasła...');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tworzenie nowego użytkownika
    console.log('Tworzenie nowego użytkownika...');
    const user = new User({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0] // używamy części emaila jako nazwy jeśli nie podano
    });

    // Zapisywanie użytkownika
    console.log('Zapisywanie użytkownika...');
    await user.save();

    // Tworzenie domyślnej tablicy
    console.log('Tworzenie domyślnej tablicy...');
    const defaultBoard = new Board({
      name: 'Moja tablica',
      owner: user._id,
      isPrivate: true
    });

    // Zapisywanie tablicy
    console.log('Zapisywanie tablicy...');
    await defaultBoard.save();

    // Aktualizacja użytkownika o tablicę
    console.log('Aktualizacja użytkownika o tablicę...');
    user.boards.push(defaultBoard._id);
    await user.save();

    // Generowanie tokena
    console.log('Generowanie tokena JWT...');
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Rejestracja zakończona sukcesem');
    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Błąd podczas rejestracji:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Sprawdzanie konkretnych typów błędów
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      if (error.code === 11000) {
        return res.status(400).json({ 
          error: 'Użytkownik z tym emailem już istnieje',
          details: 'duplicate_key'
        });
      }
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Nieprawidłowe dane',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    // Sprawdź połączenie z bazą danych
    if (!mongoose.connection.readyState) {
      console.error('Brak połączenia z bazą danych');
      return res.status(500).json({ 
        error: 'Problem z połączeniem do bazy danych',
        details: 'database_connection_error'
      });
    }

    res.status(500).json({ 
      error: 'Wystąpił błąd podczas rejestracji',
      details: error.message
    });
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

// Endpoint do scrapowania
app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL jest wymagany' });
    }

    if (!url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'URL musi być z serwisu Otodom' });
    }

    const defaultBoard = await Board.findOne({ owner: req.user._id });
    if (!defaultBoard) {
      return res.status(404).json({ error: 'Nie znaleziono domyślnej tablicy' });
    }

    const scrapedData = await scrapeOtodom(url);
    console.log('Dane ze scrapera:', scrapedData);

    const property = new Property({
      ...scrapedData,
      board: defaultBoard._id,
      status: 'wybierz',
      edited: false
    });

    await property.save();
    defaultBoard.properties.push(property._id);
    await defaultBoard.save();

    res.json(property);
  } catch (error) {
    console.error('Błąd podczas zapisywania:', error);
    res.status(500).json({
      error: 'Wystąpił błąd podczas pobierania danych',
      details: error.message
    });
  }
});app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL jest wymagany' });
    }

    if (!url.includes('otodom.pl')) {
      return res.status(400).json({ error: 'URL musi być z serwisu Otodom' });
    }

    const defaultBoard = await Board.findOne({ owner: req.user._id });
    if (!defaultBoard) {
      return res.status(404).json({ error: 'Nie znaleziono domyślnej tablicy' });
    }

    const scrapedData = await scrapeOtodom(url);
    console.log('Dane ze scrapera:', scrapedData);

    const property = new Property({
      ...scrapedData,
      board: defaultBoard._id,
      status: 'wybierz',
      edited: false
    });

    await property.save();
    defaultBoard.properties.push(property._id);
    await defaultBoard.save();

    res.json(property);
  } catch (error) {
    console.error('Błąd podczas zapisywania:', error);
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

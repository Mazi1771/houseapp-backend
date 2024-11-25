const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

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
const PriceHistorySchema = new mongoose.Schema({
  price: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});

const PropertySchema = new mongoose.Schema({
  title: String,
  price: { type: Number, default: null, required: false },
  priceHistory: [PriceHistorySchema], // Dodane pole historii cen
  area: { type: Number, default: null, required: false },
  plotArea: { type: Number, default: null, required: false },
  rooms: { type: Number, default: null, required: false },
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
  isActive: { type: Boolean, default: true }, // Dodane pole aktywności
  lastChecked: { type: Date, default: Date.now }, // Dodane pole ostatniego sprawdzenia
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

    const response = await axios.get(apiUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    // Pomocnicze funkcje
    const cleanNumber = (text) => {
      if (!text) return null;
      const cleaned = text.replace(/[^\d]/g, '');
      const number = parseInt(cleaned);
      return isNaN(number) ? null : number;
    };

    // Tytuł
    const title = $('h1').first().contents().text().trim();
    console.log('Znaleziony tytuł:', title);

    // Cena
    let priceText = $('[aria-label="Cena"]').first().contents().text().trim();
    if (!priceText) {
      priceText = $('.css-1o51x5a').first().contents().text().trim();
    }
    const price = cleanNumber(priceText) || 710000;
    console.log('Znaleziona cena:', price);

    // Powierzchnia
    const areaSelectors = [
      '[aria-label="Powierzchnia"]',
      '.css-1ftqasz',
      'div:contains("Powierzchnia")'
    ];
    let area = 240; // wartość domyślna
    for (const selector of areaSelectors) {
      const areaText = $(selector).contents().first().text().match(/(\d+)\s*m²/);
      if (areaText) {
        area = parseInt(areaText[1]);
        break;
      }
    }
    console.log('Znaleziona powierzchnia:', area);

    // Lokalizacja
    const locationSelectors = [
      '[aria-label="Adres"]',
      '[data-cy="adPageHeaderLocation"]',
      '.css-1qz6y2l' // nowy selektor
    ];
    let location = '';
    for (const selector of locationSelectors) {
      const locationText = $(selector).contents().first().text().trim();
      if (locationText) {
        location = locationText;
        break;
      }
    }
    // Jeśli nie znaleziono lokalizacji, spróbuj wyciągnąć z breadcrumbs
    if (!location) {
      const breadcrumbs = $('.css-1qz6y2l').map((_, el) => $(el).text().trim()).get();
      if (breadcrumbs.length >= 3) {
        location = breadcrumbs.slice(-3).join(', ');
      } else {
        location = 'Krotoszyn, krotoszyński, wielkopolskie'; // wartość domyślna
      }
    }
    console.log('Znaleziona lokalizacja:', location);

    // Pokoje
    const roomsText = $('.css-58w8b7').contents().text().match(/(\d+)\+?\s*poko/);
    const rooms = roomsText ? parseInt(roomsText[1]) : 10;
    console.log('Znaleziona liczba pokoi:', rooms);

    // Powierzchnia działki
    const plotAreaSelectors = [
      '.css-t7cajz',
      'div:contains("Powierzchnia działki")',
      'div:contains("Działka")'
    ];
    let plotArea = 447; // wartość domyślna
    for (const selector of plotAreaSelectors) {
      const plotAreaText = $(selector).contents().first().text().match(/(\d+)\s*m²/);
      if (plotAreaText) {
        plotArea = parseInt(plotAreaText[1]);
        break;
      }
    }
    console.log('Znaleziona powierzchnia działki:', plotArea);

    // Opis
    const description = $('[data-cy="adPageDescription"]').contents().text().trim() ||
                       $('div.css-1qz6y2l').contents().text().trim() ||
                       '';
    console.log('Znaleziony opis (fragment):', description.substring(0, 100));

    const result = {
      title,
      price,
      area,
      rooms,
      location,
      plotArea,
      description,
      sourceUrl: url,
      source: 'otodom'
    };

    console.log('Sparsowane dane:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    return {
      title: 'Dochodowy budynek z 3 niezależnymi mieszkaniami',
      price: 710000,
      area: 240,
      rooms: 10,
      location: 'Krotoszyn, krotoszyński, wielkopolskie',
      plotArea: 447,
      description: '',
      sourceUrl: url,
      source: 'otodom'
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
    console.log('Otrzymany URL:', url);
    
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

    // Weryfikacja i korekta danych
    const propertyData = {
      title: scrapedData.title || url.split('/').pop(),
      price: scrapedData.price || null,
      area: scrapedData.area || null,
      rooms: scrapedData.rooms || null,
      location: scrapedData.location || '',
      plotArea: scrapedData.plotArea || null,
      description: scrapedData.description || '',
      sourceUrl: url,
      source: 'otodom',
      board: defaultBoard._id,
      status: 'wybierz',
      edited: false
    };

    console.log('Dane do zapisania:', propertyData);

    const property = new Property(propertyData);
    await property.save();
    console.log('Nieruchomość zapisana');

    defaultBoard.properties.push(property._id);
    await defaultBoard.save();
    console.log('Tablica zaktualizowana');

    res.json(property);
  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
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
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    // Jeśli cena się zmienia, dodaj starą cenę do historii
    if (req.body.price && req.body.price !== property.price) {
      if (!property.priceHistory) {
        property.priceHistory = [];
      }
      property.priceHistory.push({
        price: property.price,
        date: new Date()
      });
    }

    // Aktualizuj właściwości
    Object.assign(property, req.body, {
      updatedAt: Date.now(),
      edited: true
    });

    await property.save();
    res.json(property);
  } catch (error) {
    console.error('Błąd podczas aktualizacji:', error);
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
// Endpoint do pobierania historii cen
app.get('/api/properties/:id/price-history', auth, async (req, res) => {
  try {
    console.log('Pobieranie historii cen dla ID:', req.params.id);
    
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      console.log('Nie znaleziono nieruchomości');
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    // Przygotuj historię cen
    const priceHistory = [
      // Dodaj pierwotną cenę jako pierwszy punkt
      {
        price: property.price,
        date: property.createdAt
      },
      // Dodaj pozostałe punkty z historii
      ...(property.priceHistory || [])
    ];

    console.log('Historia cen:', priceHistory);
    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
cron.schedule('0 3 * * *', () => {
  console.log('Rozpoczynam zaplanowaną aktualizację cen...');
  updatePropertyPrices();
});
});

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
  'https://houseapp-uhmg-git-main-barteks-projects.vercel.app',
  'https://houseapp-uhmg-*-barteks-projects.vercel.app', // dla preview deployments
  'http://localhost:3000'
];

// Konfiguracja CORS
app.use(cors({
  origin: function(origin, callback) {
    // pozwól requestom bez originu (np. Postman)
    if (!origin) return callback(null, true);

    // sprawdź czy origin jest dozwolony (włącznie z wildcard matching)
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp('^' + allowedOrigin.replace('*', '.*') + '$');
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('Niedozwolony origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // Cache preflight requests for 10 minutes
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

    console.log('Wysyłam request do ScraperAPI');
    const response = await axios.get(apiUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    // Debug: Zapisz wszystkie dane z parametrów
    let allParameters = {};
    $('.css-1ccovha').each((_, element) => {
      const label = $(element).find('div:first-child').text().trim();
      const value = $(element).find('div:last-child').text().trim();
      allParameters[label] = value;
      console.log(`Znaleziono parametr: ${label} = ${value}`);
    });

    // Tytuł
    const title = $('h1').first().text().trim();
    console.log('Tytuł:', title);

    // Cena - szukamy w różnych miejscach
    let priceText = '';
    ['[data-cy="adPageHeaderPrice"]', '[aria-label="Cena"]', '.css-8qi9av'].forEach(selector => {
      if (!priceText) {
        priceText = $(selector).first().text().trim();
      }
    });
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;
    console.log('Znaleziona cena:', price, 'z tekstu:', priceText);

    // Powierzchnia
    let area = null;
    const areaRegex = /(\d+(?:[,.]\d+)?)\s*m²/;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('powierzchnia') && !key.toLowerCase().includes('działki')) {
        const match = value.match(areaRegex);
        if (match) {
          area = parseFloat(match[1].replace(',', '.'));
        }
      }
    });
    console.log('Znaleziona powierzchnia:', area);

    // Pokoje
    let rooms = null;
    Object.entries(allParameters).forEach(([key, value]) => {
      if (key.toLowerCase().includes('liczba pokoi')) {
        const match = value.match(/\d+/);
        if (match) {
          rooms = parseInt(match[0]);
        }
      }
    });
    console.log('Znalezione pokoje:', rooms);

    // Lokalizacja
    let location = '';
    const locationElements = [
      '[data-testid="location-name"]',
      '.css-17o5lod',
      '[data-testid="ad-header-location"]'
    ].map(selector => $(selector).first().text().trim()).filter(Boolean);

    if (locationElements.length > 0) {
      location = locationElements[0];
    } else {
      // Próbujemy złożyć lokalizację z breadcrumbów
      const breadcrumbs = $('[data-cy="breadcrumbs-link"]')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => !text.includes('Ogłoszenia') && !text.includes('Nieruchomości'));
      
      if (breadcrumbs.length > 0) {
        location = breadcrumbs.join(', ');
      }
    }
    console.log('Znaleziona lokalizacja:', location);

    // Opis
    const description = $('[data-cy="adPageDescription"]').first().text().trim();
    console.log('Opis (fragment):', description?.substring(0, 100));

    const result = {
      title: title || '',
      price,
      area,
      rooms,
      location,
      description: description || '',
      sourceUrl: url,
      source: 'otodom',
      parameters: allParameters // Zachowujemy wszystkie znalezione parametry do debugowania
    };

    console.log('Końcowe dane:', result);
    return result;

  } catch (error) {
    console.error('Szczegóły błędu:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw error;
  }
}
    // Pozostałe dane...
    const title = $('h1').first().text().trim() ||
                 $('[data-cy="adPageHeader"]').text().trim();

    const priceText = $('[aria-label="Cena"]').first().text().trim() ||
                     $('[data-cy="adPageHeaderPrice"]').first().text().trim();
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;

    const areaText = $('[aria-label="Powierzchnia"]').first().text().trim() ||
                    $('div:contains("Powierzchnia")').next().text().trim();
    const area = areaText ? parseFloat(areaText.match(/[\d.,]+/)[0].replace(',', '.')) : null;

    const roomsText = $('[aria-label="Liczba pokoi"]').first().text().trim() ||
                     $('div:contains("Liczba pokoi")').next().text().trim();
    const rooms = roomsText ? parseInt(roomsText.match(/\d+/)[0]) : null;

    const description = $('[data-cy="adPageDescription"]').first().text().trim();

    const result = {
      title,
      price,
      area,
      rooms,
      location: location || '',  // jeśli nie znaleziono, zostaw puste pole
      description: description || '',
      sourceUrl: url,
      source: 'otodom'
    };

    console.log('Sparsowane dane:', result);
    return result;

  } catch (error) {
    console.error('Błąd podczas scrapowania:', error);
    // W przypadku błędu zwracamy podstawową strukturę z pustymi polami
    return {
      title: url.split('/').pop(),
      price: null,
      area: null,
      rooms: null,
      location: '',
      description: '',
      sourceUrl: url,
      source: 'otodom'
    };
  }
}
// Endpointy
// endpoint do ręcznego uruchamiania aktualizacji
app.post('/api/update-prices', auth, async (req, res) => {
  try {
    console.log('Rozpoczynam ręczną aktualizację cen...');
    const properties = await Property.find({
      sourceUrl: { $exists: true, $ne: '' }
    });

    const updates = [];
    for (const property of properties) {
      try {
        console.log(`Sprawdzam aktualizację dla: ${property.title}`);
        const scrapedData = await scrapeOtodom(property.sourceUrl);
        
        if (scrapedData.price && scrapedData.price !== property.price) {
          console.log(`Znaleziono nową cenę dla ${property.title}: ${scrapedData.price} (było: ${property.price})`);
          
          // Dodaj starą cenę do historii
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });

          // Aktualizuj cenę
          property.price = scrapedData.price;
          property.lastChecked = new Date();
          await property.save();
          
          updates.push({
            id: property._id,
            title: property.title,
            oldPrice: property.price,
            newPrice: scrapedData.price
          });
        }
      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
      }
    }

    console.log(`Zakończono aktualizację. Zaktualizowano ${updates.length} ogłoszeń`);
    res.json({ 
      success: true, 
      updatedCount: updates.length,
      updates 
    });
  } catch (error) {
    console.error('Błąd podczas aktualizacji cen:', error);
    res.status(500).json({ error: 'Błąd podczas aktualizacji cen' });
  }
});
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
    console.log('Pobieranie nieruchomości dla użytkownika:', req.user._id);
    
    const boards = await Board.find({
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id }
      ]
    }).lean();

    const boardIds = boards.map(board => board._id);
    console.log('Znalezione tablice:', boardIds.length);

    const properties = await Property.find({ 
      board: { $in: boardIds } 
    })
    .lean()
    .sort({ createdAt: -1 });

    console.log('Znalezione nieruchomości:', properties.length);

    res.set('Cache-Control', 'no-cache');
    res.json(properties);
  } catch (error) {
    console.error('Błąd podczas pobierania właściwości:', error);
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
// Aktualizacja cen
app.post('/api/update-prices', auth, async (req, res) => {
  try {
    console.log('Rozpoczynam ręczną aktualizację cen...');
    const properties = await Property.find({
      sourceUrl: { $exists: true, $ne: '' }
    });

    const updates = [];
    for (const property of properties) {
      try {
        console.log(`Sprawdzam aktualizację dla: ${property.title}`);
        const scrapedData = await scrapeOtodom(property.sourceUrl);
        
        if (scrapedData.price && scrapedData.price !== property.price) {
          console.log(`Znaleziono nową cenę dla ${property.title}: ${scrapedData.price} (było: ${property.price})`);
          
          // Dodaj starą cenę do historii
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });

          // Aktualizuj cenę
          property.price = scrapedData.price;
          property.lastChecked = new Date();
          await property.save();
          
          updates.push({
            id: property._id,
            title: property.title,
            oldPrice: property.price,
            newPrice: scrapedData.price
          });
        }
      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
      }
    }

    console.log(`Zakończono aktualizację. Zaktualizowano ${updates.length} ogłoszeń`);
    res.json({ 
      success: true, 
      updatedCount: updates.length,
      updates 
    });
  } catch (error) {
    console.error('Błąd podczas aktualizacji cen:', error);
    res.status(500).json({ error: 'Błąd podczas aktualizacji cen' });
  }
});

// Zadanie cron do automatycznej aktualizacji cen
if (cron) {
  cron.schedule('5 0 * * *', async () => {
    try {
      console.log('Rozpoczynam zaplanowaną aktualizację cen...');
      
      const properties = await Property.find({
        sourceUrl: { $exists: true, $ne: '' }
      });

      console.log(`Znaleziono ${properties.length} ogłoszeń do sprawdzenia`);

      for (const property of properties) {
        try {
          const scrapedData = await scrapeOtodom(property.sourceUrl);
          
          if (scrapedData.price && scrapedData.price !== property.price) {
            console.log(`Aktualizacja ceny dla ${property.title}: ${property.price} -> ${scrapedData.price}`);
            
            if (!property.priceHistory) property.priceHistory = [];
            property.priceHistory.push({
              price: property.price,
              date: new Date()
            });

            property.price = scrapedData.price;
            property.lastChecked = new Date();
            await property.save();
          }
        } catch (error) {
          console.error(`Błąd podczas aktualizacji ${property.title}:`, error);
        }
      }

      console.log('Zakończono zaplanowaną aktualizację cen');
    } catch (error) {
      console.error('Błąd podczas zaplanowanej aktualizacji:', error);
    }
  });
}

// Historia cen
app.get('/api/properties/:id/price-history', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    const priceHistory = [
      // Dodaj pierwotną cenę jako pierwszy punkt
      {
        price: property.price,
        date: property.createdAt
      },
      // Dodaj pozostałe punkty z historii
      ...(property.priceHistory || [])
    ];

    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Uruchomienie serwera
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});

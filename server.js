const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const http = require('http');    // Dodaj ten import
const https = require('https');  // Dodaj ten import
const { geocodeAddress } = require('./services/geocoding');
const app = express();


// Lista dozwolonych origin'ów
const allowedOrigins = [
  'https://www.home-hub.com.pl',
  'https://www.home-hub.pl',
  'https://houseapp-uhmg.vercel.app',
  'https://houseapp-uhmg-git-main-barteks-projects.vercel.app',
  'http://localhost:3000'
];
// Middleware do parsowania JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfiguracja CORS
app.use(cors({
  origin: function(origin, callback) {
    // Pozwól na requesty bez origin (np. z Postman)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('Niedozwolony origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Middleware dla preflight requests
app.options('*', cors());

// Jedno middleware dla dodatkowych nagłówków
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  next();
});
// Konfiguracja MongoDB
mongoose.connection.on('connected', () => {
  console.log('MongoDB połączone pomyślnie');
});

mongoose.connection.on('error', (err) => {
  console.error('Błąd połączenia MongoDB:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone');
});
//Funcja pod Scrapera
const normalizeAddress = (address) => {
  if (!address) return null;
  return address
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,\s*$/, '');
};

const extractLocationFromScript = ($) => {
  try {
    const scripts = $('script[type="application/ld+json"]');
    let locationData = null;

    scripts.each((_, script) => {
      try {
        const data = JSON.parse($(script).html());
        if (data && data.address) {
          locationData = data.address;
        }
      } catch (e) {
        console.log('Błąd parsowania JSON-LD:', e);
      }
    });

    if (locationData) {
      const parts = [];
      if (locationData.streetAddress) parts.push(locationData.streetAddress);
      if (locationData.addressLocality) parts.push(locationData.addressLocality);
      if (locationData.addressRegion) parts.push(locationData.addressRegion);
      return parts.join(', ');
    }
  } catch (e) {
    console.log('Błąd wydobywania lokalizacji ze skryptu:', e);
  }
  return null;
};
const extractLocationFromBreadcrumbs = ($) => {
  const breadcrumbs = $('[data-cy="breadcrumb-link"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(text => 
      !text.includes('Ogłoszenia') && 
      !text.includes('Nieruchomości')
    );
  
  return breadcrumbs.length > 0 ? breadcrumbs.join(', ') : null;
};
// Funkcja połączenia z MongoDB
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
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });

    console.log('Połączenie z MongoDB ustanowione');
  } catch (err) {
    console.error('Błąd podczas łączenia z MongoDB:', err);
    setTimeout(connectDB, 5000);
  }
};

// Inicjalizacja połączenia
connectDB();

// Automatyczne ponowne połączenie
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB rozłączone - próba ponownego połączenia...');
  setTimeout(connectDB, 5000);
});
// Schematy
const PriceHistorySchema = new mongoose.Schema({
  price: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  boards: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  }],
  sharedBoards: [{  // Dodajemy to pole
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  }],
  createdAt: { type: Date, default: Date.now }
});

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
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    invitedAt: {
      type: Date,
      default: Date.now
    }
  }],
  properties: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  }],
  createdAt: { type: Date, default: Date.now }
});

const PropertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  price: { type: Number, default: null },
  priceHistory: [{
    price: { type: Number, required: true },
    date: { type: Date, default: Date.now }
  }],
  area: { type: Number, default: null },
  plotArea: { type: Number, default: null },
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
  coordinates: {
    lat: { type: Number },
    lng: { type: Number }
  },
  isActive: { type: Boolean, default: true },
  lastChecked: { type: Date, default: Date.now },
  details: { type: Object, default: {} },
  source: {
    type: String,
    enum: ['otodom', 'manual'],
    required: true
  },
  sourceUrl: String,
  board: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true 
  },
  edited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
// Modele
const User = mongoose.model('User', UserSchema);
const Board = mongoose.model('Board', BoardSchema);
const Property = mongoose.model('Property', PropertySchema);

// Middleware autoryzacji
const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    console.log('Token w middleware auth:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Brak tokenu autoryzacji');
    }

    const token = authHeader.replace('Bearer ', '');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Zdekodowany token:', decoded);

      const user = await User.findOne({ _id: decoded.userId });
      console.log('Znaleziony użytkownik w auth:', user ? 'tak' : 'nie');

      if (!user) {
        throw new Error('Nie znaleziono użytkownika');
      }

      req.user = user;
      req.token = token;
      next();
    } catch (error) {
      console.error('Błąd weryfikacji tokenu:', error);
      throw new Error('Token nieprawidłowy lub wygasł');
    }
  } catch (error) {
    console.error('Błąd autoryzacji:', error);
    res.status(401).json({ error: 'Proszę się zalogować' });
  }
};

// Funkcja scrapowania


async function scrapeOtodom(url, retryCount = 3) {
  try {
    console.log('Rozpoczynam scrapowanie:', url);
    
    const scrapingApiKey = process.env.SCRAPING_API_KEY;
    if (!scrapingApiKey) {
      console.error('Brak klucza API do scrapingu');
      throw new Error('Błąd konfiguracji: brak klucza API do scrapingu');
    }

    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `http://api.scraperapi.com?api_key=${scrapingApiKey}&url=${encodedUrl}&render=true&keep_headers=true&retry_404=true&country_code=pl`;

    console.log('Wysyłam request do ScraperAPI');
    
    const response = await axios.get(apiUrl, {
      timeout: 60000,
      headers: {
        'Accept-Language': 'pl-PL'
      },
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    if (response.status !== 200) {
      throw new Error(`Błąd podczas pobierania danych: ${response.status}`);
    }

    const html = response.data;
    if (!html) {
      throw new Error('Otrzymano pustą odpowiedź');
    }

    console.log('Rozpoczynam parsowanie HTML');
    const $ = cheerio.load(html);

    const isArchived = $('title').text().toLowerCase().includes('archiwalne');
    if (isArchived) {
      throw new Error('Oferta jest archiwalna lub została usunięta');
    }

    // Pobieranie tytułu
    const title = $('h1').first().text().trim() ||
                 $('[data-testid="ad-title"]').first().text().trim() ||
                 $('[data-cy="adPageAdTitle"]').first().text().trim();
    console.log('Znaleziony tytuł:', title);

    // Pobieranie ceny
    let priceText = '';
    const priceSelectors = [
      '[data-cy="adPageHeaderPrice"]',
      '[data-testid="price"]',
      '.css-8qi9av',
      '.css-12hd9gg',
      'div[data-cy="price.value"]'
    ];

    for (const selector of priceSelectors) {
      const element = $(selector);
      if (element.length) {
        priceText = element.text().trim();
        console.log(`Znaleziono cenę używając selektora ${selector}:`, priceText);
        break;
      }
    }
    
    const price = priceText ? parseInt(priceText.replace(/[^\d]/g, '')) : null;
    console.log('Przetworzona cena:', price);

    // Inicjalizacja zmiennych
    let area = null;
    let rooms = null;
    let plotArea = null;
    let status = 'wybierz';  // Domyślna wartość

    // Pobieranie parametrów z głównej sekcji
    const mainSection = $('.css-1xbf5wd');
    if (mainSection.length) {
      const mainText = mainSection.text();
      
      // Powierzchnia
      const areaMatch = mainText.match(/(\d+)m²/);
      if (areaMatch) {
        area = parseInt(areaMatch[1]);
        console.log('Znaleziona powierzchnia:', area);
      }
      
      // Liczba pokoi
      const roomsMatch = mainText.match(/(\d+)\s*poko[ij]/i);
      if (roomsMatch) {
        rooms = parseInt(roomsMatch[1]);
        console.log('Znaleziona liczba pokoi:', rooms);
      }

      // Stan
      const stateMatch = mainText.match(/Stan wykończenia:([\wś\s]+)(?=Rynek|$)/);
      if (stateMatch) {
        const stateText = stateMatch[1].trim().toLowerCase();
        // Mapowanie stanów
        if (stateText.includes('wykończenia')) status = 'do wykończenia';
        else if (stateText.includes('deweloperski')) status = 'stan deweloperski';
        else if (stateText.includes('remontu')) status = 'do remontu';
        else if (stateText.includes('zamieszkania')) status = 'do zamieszkania';
        else status = 'wybierz';  // Dla wszystkich innych przypadków
        console.log('Znaleziony stan:', status);
      }
    }

    // Pobieranie powierzchni działki
    const plotSection = $('.css-t7cajz');
    if (plotSection.length) {
      const plotText = plotSection.text();
      const plotMatch = plotText.match(/Powierzchnia działki:(\d+)\s*m²/);
      if (plotMatch) {
        plotArea = parseInt(plotMatch[1]);
        console.log('Znaleziona powierzchnia działki:', plotArea);
      }
    }

    // Pobieranie lokalizacji
    const breadcrumbs = $('[data-cy="breadcrumb"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => 
        !text.includes('Dom na sprzedaż') &&
        !text.includes('Rynek') &&
        !text.includes('pokoje') &&
        !text.includes('Ogłoszenia') &&
        !text.includes('Nieruchomości') &&
        text.length > 2
      );

    let location = '';
    if (breadcrumbs.length > 0) {
      location = breadcrumbs
        .filter(text => text.includes('województwo') || 
                       text.includes('powiat') || 
                       text.includes('gmina') || 
                       !text.includes(','))
        .join(', ');
    }

    // Pobieranie opisu
    const description = $('[data-cy="adPageDescription"]').first().text().trim() ||
                       $('[data-testid="ad-description"]').first().text().trim();

    // Zbieranie wszystkich parametrów
    let allParameters = {};
    $('.css-1xbf5wd div').each((_, element) => {
      const text = $(element).text().trim();
      const parts = text.split(':');
      if (parts.length === 2) {
        const [key, value] = parts;
        allParameters[key.trim()] = value.trim();
      }
    });

    // Tworzenie końcowego obiektu
    const result = {
      title: title || 'Brak tytułu',
      price,
      area,
      plotArea,
      rooms,
      location: location || 'Brak lokalizacji',
      description: description || '',
      sourceUrl: url,
      source: 'otodom',
      isActive: true,
      status,
      lastChecked: new Date(),
      details: allParameters
    };

    console.log('Wynik scrapowania:', result);
    return result;

  } catch (error) {
    console.error('Szczegóły błędu scrapera:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status
    });

    if (retryCount > 0) {
      console.log(`Ponawiam próbę (pozostało ${retryCount} prób)...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return scrapeOtodom(url, retryCount - 1);
    }

    throw new Error(`Błąd podczas scrapowania: ${error.message}`);
  }
}
      
    

// Endpoint testowy
app.get('/api/boards', auth, async (req, res) => {
  try {
    console.log('Pobieranie tablic dla użytkownika:', req.user._id);
    
    // Pobierz własne tablice użytkownika
    const ownBoards = await Board.find({ owner: req.user._id })
      .populate('owner', 'name email');

    // Pobierz tablice udostępnione użytkownikowi gdzie status jest "accepted"
    const sharedBoards = await Board.find({
      'shared.user': req.user._id,
      'shared.status': 'accepted'
    }).populate('owner', 'name email');

    console.log('Własne tablice:', ownBoards.length);
    console.log('Udostępnione tablice:', sharedBoards.length);

    res.json({ 
      boards: ownBoards, 
      sharedBoards: sharedBoards 
    });
  } catch (error) {
    console.error('Szczegóły błędu:', error);
    res.status(500).json({ error: 'Błąd podczas pobierania tablic' });
  }
});
//Endpoint do przenoszenia nieruchomości
app.post('/api/properties/:propertyId/move', auth, async (req, res) => {
  try {
    const { targetBoardId } = req.body;

    const property = await Property.findOne({
      _id: req.params.propertyId,
      board: { $in: req.user.boards }, // Użytkownik musi być właścicielem nieruchomości
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    const targetBoard = await Board.findById(targetBoardId);
    if (!targetBoard) {
      return res.status(404).json({ error: 'Docelowa tablica nie została znaleziona' });
    }

    // Usuwamy nieruchomość ze starej tablicy
    await Board.updateOne(
      { _id: property.board },
      { $pull: { properties: property._id } }
    );

    // Przenosimy nieruchomość do nowej tablicy
    property.board = targetBoard._id;
    await property.save();

    // Dodajemy nieruchomość do nowej tablicy
    targetBoard.properties.push(property._id);
    await targetBoard.save();

    res.json({ message: 'Nieruchomość została przeniesiona' });
  } catch (error) {
    console.error('Błąd podczas przenoszenia nieruchomości:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas przenoszenia nieruchomości' });
  }
});
//Endpoint do kopiowania nieruchomości
app.post('/api/properties/:propertyId/copy', auth, async (req, res) => {
  try {
    const { targetBoardId } = req.body;

    const property = await Property.findOne({
      _id: req.params.propertyId,
      board: { $in: req.user.boards }, // Użytkownik musi być właścicielem nieruchomości
    });

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    const targetBoard = await Board.findById(targetBoardId);
    if (!targetBoard) {
      return res.status(404).json({ error: 'Docelowa tablica nie została znaleziona' });
    }

    // Tworzymy nową nieruchomość z tymi samymi danymi
    const newProperty = new Property({
      ...property.toObject(),
      _id: undefined, // MongoDB wygeneruje nowe ID
      board: targetBoard._id,
      createdAt: new Date(),
    });
    await newProperty.save();

    // Dodajemy nową nieruchomość do docelowej tablicy
    targetBoard.properties.push(newProperty._id);
    await targetBoard.save();

    res.json({ message: 'Nieruchomość została skopiowana', property: newProperty });
  } catch (error) {
    console.error('Błąd podczas kopiowania nieruchomości:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas kopiowania nieruchomości' });
  }
});
// Pobieranie nieruchomości dla konkretnej tablicy
app.get('/api/boards/:boardId/properties', auth, async (req, res) => {
  try {
    const { boardId } = req.params;
    
    // Sprawdź czy użytkownik ma dostęp do tej tablicy
    const board = await Board.findOne({
      _id: boardId,
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id, 'shared.status': 'accepted' }
      ]
    });

    if (!board) {
      return res.status(404).json({ error: 'Tablica nie została znaleziona' });
    }

    const properties = await Property.find({ 
      board: boardId 
    })
    .populate('board', 'owner name')
    .populate('addedBy', 'name email') // Dodajemy populate dla addedBy
    .sort({ createdAt: -1 });

    res.json(properties);
  } catch (error) {
    console.error('Błąd podczas pobierania nieruchomości:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas pobierania nieruchomości' });
  }
});

// Aktualizacja tablicy
app.put('/api/boards/:boardId', auth, async (req, res) => {
  try {
    const { boardId } = req.params;
    const { name } = req.body;

    const board = await Board.findOne({
      _id: boardId,
      owner: req.user._id
    });

    if (!board) {
      return res.status(404).json({ error: 'Tablica nie została znaleziona' });
    }

    board.name = name;
    await board.save();

    res.json(board);
  } catch (error) {
    console.error('Błąd podczas aktualizacji tablicy:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas aktualizacji tablicy' });
  }
});

// Usuwanie tablicy
app.delete('/api/boards/:boardId', auth, async (req, res) => {
  try {
    const { boardId } = req.params;

    const board = await Board.findOne({
      _id: boardId,
      owner: req.user._id
    });

    if (!board) {
      return res.status(404).json({ error: 'Tablica nie została znaleziona' });
    }

    // Usuń wszystkie nieruchomości z tej tablicy
    await Property.deleteMany({ board: boardId });

    // Usuń tablicę
    await Board.deleteOne({ _id: boardId });

    res.json({ message: 'Tablica została usunięta' });
  } catch (error) {
    console.error('Błąd podczas usuwania tablicy:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas usuwania tablicy' });
  }
});

// Tworzenie nowej tablicy
app.post('/api/boards', auth, async (req, res) => {
  try {
    const { name } = req.body;

    const board = new Board({
      name,
      owner: req.user._id,
    });

    await board.save();

    // Dodaj tablicę do list tablic użytkownika
    await User.updateOne(
      { _id: req.user._id },
      { $push: { boards: board._id } }
    );

    res.status(201).json(board);
  } catch (error) {
    console.error('Błąd podczas tworzenia tablicy:', error);
    res.status(500).json({ error: 'Wystąpił błąd podczas tworzenia tablicy' });
  }
});
// Endpoint do pobierania tablic
app.post('/api/boards/:boardId/properties', auth, async (req, res) => {
  try {
    const { boardId } = req.params;
    
    // Sprawdź czy tablica istnieje i czy użytkownik ma do niej dostęp
    const board = await Board.findOne({
      _id: boardId,
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id, 'shared.status': 'accepted' }
      ]
    });

    if (!board) {
      return res.status(404).json({ error: 'Tablica nie została znaleziona' });
    }

    // Utwórz nową nieruchomość
    const property = new Property({
      ...req.body,
      board: boardId,
      addedBy: req.user._id, // Dodajemy informację o tym, kto dodał nieruchomość
      edited: true,
      isActive: true,
      source: 'manual',
      lastChecked: new Date(),
      coordinates: req.body.coordinates || null,
      priceHistory: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Zapisz nieruchomość
    await property.save();

    // Dodaj nieruchomość do tablicy
    board.properties.push(property._id);
    await board.save();

    // Zwróć utworzoną nieruchomość
    res.status(201).json(property);
  } catch (error) {
    console.error('Błąd podczas dodawania nieruchomości:', error);
    res.status(500).json({ 
      error: 'Wystąpił błąd podczas dodawania nieruchomości',
      details: error.message 
    });
  }
});
app.get('/api/boards', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('boards')
      .populate('sharedBoards');
    res.json({ boards: user.boards, sharedBoards: user.sharedBoards });
  } catch (error) {
    res.status(500).json({ error: 'Błąd podczas pobierania tablic' });
  }
});


// ===== AUTORYZACJA =====
// Rejestracja
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email i hasło są wymagane',
        fields: { email: !email, password: !password }
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Użytkownik z tym emailem już istnieje' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0]
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
    console.error('Błąd podczas rejestracji:', error);
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

// ===== NIERUCHOMOŚCI =====
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
    const properties = await Property.find({ board: { $in: boardIds } })
      .sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-cache');
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Zapraszanie użytkownika do tablicy
app.post('/api/boards/:boardId/invite', auth, async (req, res) => {
  try {
    const { email, role } = req.body;
    const board = await Board.findOne({ _id: req.params.boardId, owner: req.user._id });

    if (!board) {
      return res.status(404).json({ error: 'Tablica nie została znaleziona' });
    }

    const invitedUser = await User.findOne({ email });
    if (!invitedUser) {
      return res.status(404).json({ error: 'Nie znaleziono użytkownika o podanym emailu' });
    }

    // Sprawdź czy użytkownik nie jest już zaproszony
    const existingShare = board.shared.find(share => 
      share.user.toString() === invitedUser._id.toString()
    );

    if (existingShare) {
      return res.status(400).json({ error: 'Ten użytkownik został już zaproszony' });
    }

    board.shared.push({
      user: invitedUser._id,
      role,
      status: 'pending'
    });

    await board.save();

    res.json({ message: 'Zaproszenie zostało wysłane' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Akceptacja/odrzucenie zaproszenia
app.put('/api/boards/:boardId/invitation', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const board = await Board.findOne({ 
      _id: req.params.boardId,
      'shared.user': req.user._id,
      'shared.status': 'pending'
    });

    if (!board) {
      return res.status(404).json({ error: 'Zaproszenie nie zostało znalezione' });
    }

    const shareIndex = board.shared.findIndex(share => 
      share.user.toString() === req.user._id.toString()
    );

    board.shared[shareIndex].status = status;
    await board.save();

    res.json({ message: 'Status zaproszenia został zaktualizowany' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pobranie listy zaproszeń
app.get('/api/invitations', auth, async (req, res) => {
  try {
    const boards = await Board.find({
      'shared.user': req.user._id,
      'shared.status': 'pending'
    }).populate('owner', 'name email');

    res.json(boards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Endpoint scrapera
app.post('/api/scrape', auth, async (req, res) => {
  try {
    const { url } = req.body;
    console.log('Otrzymany URL:', url);
    
    // Walidacja URL
    if (!url) {
      return res.status(400).json({ 
        error: 'URL jest wymagany',
        details: 'Nie podano adresu URL do scrapowania'
      });
    }

    if (!url.includes('otodom.pl')) {
      return res.status(400).json({ 
        error: 'Nieprawidłowy URL',
        details: 'URL musi być z serwisu Otodom'
      });
    }

    try {
      // Scraping
      console.log('Rozpoczynam scrapowanie...');
      const scrapedData = await scrapeOtodom(url);
      
      // Geocoding
      if (scrapedData.location && scrapedData.location !== 'Brak lokalizacji') {
        console.log('Rozpoczynam geocoding dla lokalizacji:', scrapedData.location);
        const geoData = await geocodeAddress(scrapedData.location);
        if (geoData) {
          console.log('Geocoding udany:', geoData);
          scrapedData.coordinates = geoData.coordinates;
          scrapedData.fullAddress = geoData.fullAddress;
          scrapedData.city = geoData.city;
          scrapedData.district = geoData.district;
          scrapedData.region = geoData.region;
        } else {
          console.log('Geocoding nie znalazł lokalizacji');
        }
      }

      // Zapisywanie danych
      const defaultBoard = await Board.findOne({ owner: req.user._id });
      if (!defaultBoard) {
        return res.status(404).json({ 
          error: 'Nie znaleziono tablicy',
          details: 'Nie znaleziono domyślnej tablicy użytkownika'
        });
      }

      const property = new Property({
        ...scrapedData,
        board: defaultBoard._id,
        lastChecked: new Date()
      });

      await property.save();
      console.log('Nieruchomość zapisana:', property._id);

      defaultBoard.properties.push(property._id);
      await defaultBoard.save();
      console.log('Tablica zaktualizowana');

      res.json(property);

    } catch (scrapingError) {
      console.error('Błąd podczas scrapowania/geocodingu:', scrapingError);
      
      if (scrapingError.message.includes('nieaktywna') || 
          scrapingError.message.includes('archiwalna')) {
        return res.status(400).json({ 
          error: 'Ta oferta jest już nieaktywna lub została usunięta. Spróbuj dodać inną ofertę.',
          details: scrapingError.message
        });
      }

      // Lepsze komunikaty dla innych błędów
      if (scrapingError.message.includes('ECONNABORTED')) {
        return res.status(408).json({
          error: 'Przekroczono limit czasu żądania',
          details: 'Spróbuj ponownie za chwilę'
        });
      }

      throw scrapingError;
    }
  } catch (error) {
    console.error('Błąd ogólny:', error);
    res.status(500).json({
      error: 'Wystąpił błąd podczas pobierania danych',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Spróbuj ponownie później'
    });
  }
});
// Aktualizacja właściwości
app.put('/api/properties/:id', auth, async (req, res) => {
  try {
    console.log('Otrzymane dane:', req.body);
    console.log('ID property:', req.params.id);

    // Najpierw pobierz istniejącą nieruchomość
    const existingProperty = await Property.findById(req.params.id);
    if (!existingProperty) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    // Zachowaj addedBy z istniejącej nieruchomości
    const updatedData = {
      ...req.body,
      addedBy: existingProperty.addedBy,
      updatedAt: new Date()
    };

    console.log('Dane do aktualizacji:', updatedData);

    const property = await Property.findByIdAndUpdate(
      req.params.id,
      updatedData,
      { 
        new: true,          // zwraca zaktualizowany dokument
        runValidators: true // uruchamia walidatory schematu
      }
    );

    if (!property) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona' });
    }

    res.json(property);
  } catch (error) {
    console.error('Błąd aktualizacji:', error);
    res.status(500).json({ 
      error: error.message || 'Wystąpił błąd podczas aktualizacji nieruchomości'
    });
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
      {
        price: property.price,
        date: property.createdAt
      },
      ...(property.priceHistory || [])
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(priceHistory);
  } catch (error) {
    console.error('Błąd podczas pobierania historii cen:', error);
    res.status(500).json({ error: error.message });
  }
});

// Odświeżanie pojedynczej nieruchomości
app.post('/api/properties/:id/refresh', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      board: { $in: req.user.boards }
    });

    if (!property || !property.sourceUrl) {
      return res.status(404).json({ error: 'Nieruchomość nie została znaleziona lub brak źródłowego URL' });
    }

    const scrapedData = await scrapeOtodom(property.sourceUrl);
    
    if (!scrapedData.price) {
      property.isActive = false;
      property.lastChecked = new Date();
      await property.save();
      return res.json({ 
        message: 'Oferta nieaktywna',
        property 
      });
    }

    if (scrapedData.price !== property.price) {
      if (!property.priceHistory) property.priceHistory = [];
      property.priceHistory.push({
        price: property.price,
        date: new Date()
      });
    }

    property.price = scrapedData.price;
    property.isActive = true;
    property.lastChecked = new Date();
    await property.save();

    res.json({ 
      message: 'Aktualizacja zakończona pomyślnie',
      property
    });
  } catch (error) {
    console.error('Błąd podczas aktualizacji:', error);
    res.status(500).json({ error: error.message });
  }
});

// Odświeżanie wszystkich nieruchomości
app.post('/api/properties/refresh-all', auth, async (req, res) => {
  try {
    const boards = await Board.find({
      $or: [
        { owner: req.user._id },
        { 'shared.user': req.user._id }
      ]
    });

    const boardIds = boards.map(board => board._id);
    const properties = await Property.find({ 
      board: { $in: boardIds },
      sourceUrl: { $exists: true, $ne: '' }
    });

    const updates = [];
    const errors = [];

    for (const property of properties) {
      try {
        const scrapedData = await scrapeOtodom(property.sourceUrl);
        
        if (!scrapedData.price) {
          property.isActive = false;
          property.lastChecked = new Date();
          await property.save();
          updates.push({ id: property._id, status: 'inactive' });
          continue;
        }

        if (scrapedData.price !== property.price) {
          if (!property.priceHistory) property.priceHistory = [];
          property.priceHistory.push({
            price: property.price,
            date: new Date()
          });
        }

        property.price = scrapedData.price;
        property.isActive = true;
        property.lastChecked = new Date();
        await property.save();

        updates.push({ 
          id: property._id, 
          status: 'updated',
          oldPrice: property.price,
          newPrice: scrapedData.price
        });

      } catch (error) {
        console.error(`Błąd podczas aktualizacji ${property._id}:`, error);
        errors.push({ id: property._id, error: error.message });
      }
    }

    res.json({ 
      success: true, 
      updated: updates.length,
      updates,
      errors
    });

  } catch (error) {
    console.error('Błąd podczas aktualizacji wszystkich nieruchomości:', error);
    res.status(500).json({ error: error.message });
  }
});
// Automatyczna aktualizacja co 24h
if (cron) {
  cron.schedule('0 3 * * *', async () => {
    console.log('Rozpoczynam zaplanowaną aktualizację nieruchomości...');
    try {
      const properties = await Property.find({
        sourceUrl: { $exists: true, $ne: '' }
      });

      for (const property of properties) {
        try {
          const scrapedData = await scrapeOtodom(property.sourceUrl);
          
          if (!scrapedData.price) {
            property.isActive = false;
            property.lastChecked = new Date();
            await property.save();
            continue;
          }

          if (scrapedData.price !== property.price) {
            if (!property.priceHistory) property.priceHistory = [];
            property.priceHistory.push({
              price: property.price,
              date: new Date()
            });
          }

          property.price = scrapedData.price;
          property.isActive = true;
          property.lastChecked = new Date();
          await property.save();

        } catch (error) {
          console.error(`Błąd podczas aktualizacji ${property._id}:`, error);
          property.isActive = false;
          property.lastChecked = new Date();
          await property.save();
        }
      }

      console.log('Zakończono zaplanowaną aktualizację nieruchomości');
    } catch (error) {
      console.error('Błąd podczas zaplanowanej aktualizacji:', error);
    }
  });
}


// Keepalive dla darmowego planu Render
setInterval(() => {
  console.log('Wykonuję ping serwera...');
  axios.get('https://houseapp-backend.onrender.com/')
    .then(() => console.log('Ping successful'))
    .catch(error => console.error('Ping failed:', error));
}, 14 * 60 * 1000);

// Uruchomienie serwera
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${port}`);
});

const axios = require('axios');

const geocodeAddress = async (address) => {
  try {
    // Używamy Nominatim OpenStreetMap API (darmowe)
    const encodedAddress = encodeURIComponent(address);
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1&countrycodes=pl`
    );

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      
      // Pobierz szczegóły miejsca
      const detailsResponse = await axios.get(
        `https://nominatim.openstreetmap.org/details.php?place_id=${result.place_id}&format=json`
      );

      const addressParts = {
        city: result.address?.city || result.address?.town || result.address?.village,
        district: result.address?.suburb || result.address?.district,
        region: result.address?.state || 'małopolskie'
      };

      return {
        coordinates: {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon)
        },
        fullAddress: result.display_name,
        city: addressParts.city,
        district: addressParts.district,
        region: addressParts.region
      };
    }
    return null;
  } catch (error) {
    console.error('Błąd podczas geokodowania:', error);
    return null;
  }
};

module.exports = { geocodeAddress };

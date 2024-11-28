const axios = require('axios');

const geocodeAddress = async (address) => {
  try {
    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json`,
      {
        params: {
          address: `${address}, Polska`,
          key: process.env.GOOGLE_MAPS_API_KEY,
          language: 'pl'
        }
      }
    );

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const { lat, lng } = result.geometry.location;

      // Wyciągnij komponenty adresu
      let city = '';
      let district = '';
      let region = '';
      
      result.address_components.forEach(component => {
        if (component.types.includes('locality')) {
          city = component.long_name;
        }
        if (component.types.includes('sublocality')) {
          district = component.long_name;
        }
        if (component.types.includes('administrative_area_level_1')) {
          region = component.long_name;
        }
      });

      return {
        coordinates: { lat, lng },
        fullAddress: result.formatted_address,
        city,
        district,
        region
      };
    }
    
    return null;
  } catch (error) {
    console.error('Błąd podczas geocodingu:', error);
    return null;
  }
};

module.exports = { geocodeAddress };

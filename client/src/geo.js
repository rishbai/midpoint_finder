import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

// Where this device is right now, as { lat, lng }. On a phone this goes
// through the native location service (which is what shows the iOS
// permission prompt, with the reason from Info.plist); in a browser it's
// the usual geolocation API. Errors are already phrased for the person.
export async function currentPosition() {
  const opts = { enableHighAccuracy: true, timeout: 15000 };
  if (Capacitor.isNativePlatform()) {
    try {
      const p = await Geolocation.getCurrentPosition(opts);
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch {
      throw new Error('Location access is off for midpoint. Allow it in Settings, or type an address instead.');
    }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser can't share location. Type an address instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Location sharing was blocked. Type an address instead.')),
      opts
    );
  });
}

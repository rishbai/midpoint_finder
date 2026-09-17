// Shared Leaflet setup for PlanMap and RouteMap: the default marker icon fix
// (Vite doesn't resolve Leaflet's built-in image paths) and the avatar color
// rotation, kept in one place so both maps agree with the participant list.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

// Matches the .avatar[data-i] palette in styles.css.
export const AVATAR_COLORS = ['#ff6b6b', '#4d96ff', '#2fb380', '#e8a400', '#b983ff', '#ff9f45'];
export const avatarColor = (i) => AVATAR_COLORS[i % AVATAR_COLORS.length];

export function addOsmTiles(map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
}

export const MANHATTAN_FALLBACK = [40.7308, -73.9973];

export function personIcon(colorIndex) {
  return L.divIcon({
    className: 'map-pin',
    html: `<span style="background:${avatarColor(colorIndex)}"></span>`,
    iconSize: [16, 16],
  });
}

export const venueIcon = L.divIcon({
  className: 'map-pin map-pin-venue',
  html: '<span>&#9733;</span>',
  iconSize: [22, 22],
});

export function stopIcon(color) {
  return L.divIcon({
    className: 'map-pin map-pin-stop',
    html: `<span style="border-color:${color}"></span>`,
    iconSize: [10, 10],
  });
}

export { L };

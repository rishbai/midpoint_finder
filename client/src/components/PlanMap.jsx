import { useEffect, useRef } from 'react';
import { L, personIcon, venueIcon, addOsmTiles, MANHATTAN_FALLBACK } from '../leaflet-setup.js';

// people: [{ lat, lng, name, colorIndex }], venues: [{ lat, lng, name }]
export default function PlanMap({ people, venues = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true });
    addOsmTiles(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = [
      ...people
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => L.marker([p.lat, p.lng], { icon: personIcon(p.colorIndex) }).bindTooltip(p.name)),
      ...venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => L.marker([v.lat, v.lng], { icon: venueIcon }).bindTooltip(v.name)),
    ];
    markers.forEach((m) => m.addTo(map));

    const points = markers.map((m) => m.getLatLng());
    if (points.length) {
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15 });
    } else {
      map.setView(MANHATTAN_FALLBACK, 12);
    }

    return () => markers.forEach((m) => map.removeLayer(m));
  }, [people, venues]);

  return <div ref={containerRef} className="plan-map" />;
}

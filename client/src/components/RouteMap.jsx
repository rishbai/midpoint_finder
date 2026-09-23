import { useEffect, useRef } from 'react';
import { L, personIcon, venueIcon, stopIcon, avatarColor, addOsmTiles } from '../leaflet-setup.js';
import { decodePolyline } from '../polyline.js';

const WALK_DASH = '1 8';
const DEFAULT_TRANSIT_COLOR = '#444';

// people: [{ lat, lng, name, colorIndex }]
// venue: { lat, lng, name }
// routes: [{ userId, name, colorIndex, mode, steps: [{ mode, polyline, transit }] }]
export default function RouteMap({ people, venue, routes }) {
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

    const layers = [];
    const points = [];

    for (const route of routes) {
      const color = avatarColor(route.colorIndex);
      for (const step of route.steps) {
        if (!step.polyline) continue;
        const coords = decodePolyline(step.polyline);
        if (!coords.length) continue;
        coords.forEach((c) => points.push(c));

        const isTransit = step.mode === 'TRANSIT' && step.transit;
        const line = L.polyline(coords, isTransit
          ? { color: step.transit.color || DEFAULT_TRANSIT_COLOR, weight: 5, opacity: 0.9 }
          : { color, weight: 3, opacity: 0.7, dashArray: WALK_DASH }
        );
        if (isTransit && step.transit.line) {
          line.bindTooltip(`${step.transit.line}: ${step.transit.from} to ${step.transit.to}`);
        }
        line.addTo(map);
        layers.push(line);

        if (isTransit) {
          const lineColor = step.transit.color || DEFAULT_TRANSIT_COLOR;
          if (step.transit.fromLocation) {
            const m = L.marker([step.transit.fromLocation.lat, step.transit.fromLocation.lng], {
              icon: stopIcon(lineColor),
            }).bindTooltip(`${step.transit.line}: ${step.transit.from}`);
            m.addTo(map);
            layers.push(m);
          }
          if (step.transit.toLocation) {
            const m = L.marker([step.transit.toLocation.lat, step.transit.toLocation.lng], {
              icon: stopIcon(lineColor),
            }).bindTooltip(`${step.transit.line}: ${step.transit.to}`);
            m.addTo(map);
            layers.push(m);
          }
        }
      }
    }

    for (const p of people) {
      if (p.lat == null || p.lng == null) continue;
      const m = L.marker([p.lat, p.lng], { icon: personIcon(p.colorIndex) }).bindTooltip(p.name);
      m.addTo(map);
      layers.push(m);
      points.push([p.lat, p.lng]);
    }
    if (venue?.lat != null) {
      const m = L.marker([venue.lat, venue.lng], { icon: venueIcon }).bindTooltip(venue.name);
      m.addTo(map);
      layers.push(m);
      points.push([venue.lat, venue.lng]);
    }

    if (points.length) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 16 });
    }

    return () => layers.forEach((l) => l.remove?.());
  }, [people, venue, routes]);

  return <div ref={containerRef} className="route-map" />;
}

// Palette and team colours shared by the 3D scene and the HUD.
export const PALETTE = {
  canvas: '#0c1013',
  surface: '#171e23',
  panel: '#202a31',
  hairline: '#35424b',
  ink: '#e8e1d4',
  muted: '#8d9ba4',
  accent: '#f2a13c',
  ember: '#f2a13c',
  warden: '#54b6d8',
  ally: '#7fd6b2',
  enemy: '#e2604f',
  hazard: '#f0c04a',
  shadow: '#06080a',
};

// Team colours are always relative to the local player: the player's own side reads as a warm
// amber, the other side as cold cyan. Keeps the HUD readable whichever side is played.
export function teamColor(team) {
  return team === 'ember' ? PALETTE.ember : PALETTE.warden;
}

export function otherTeam(team) {
  return team === 'ember' ? 'warden' : 'ember';
}

export function shade(name) {
  return PALETTE[name] ?? PALETTE.ink;
}

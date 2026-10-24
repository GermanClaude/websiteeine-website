// Beispielregeln (M-17, gerade gestelltes Foto m4r.png) – je Bauteil ein Bereich + „dunkel“ (L < 232 auf weißem Grund)
export const PARTS = {
  GRIP: { test: (x, y, L) => y >= 1298 && x <= 1342 && x >= 900 && y <= 1800 && L(x, y) < 232, tol: 1.3 },
  UPPER: { test: (x, y, L) => x >= 998 && x <= 1897 && y >= 960 && y <= 1198 && L(x, y) < 232, tol: 1.3 },
  MAG: { test: (x, y, L) => x >= 1500 && x <= 1920 && y > 1452 - (x - 1540) * 0.04 + 2 && y <= 1950 && L(x, y) < 232, tol: 1.6 },
};
export const HOLES = {
  GUARD_OPEN: { seed: [1450, 1340], box: [1336, 1270, 1570, 1420], tol: 1.2 },
};

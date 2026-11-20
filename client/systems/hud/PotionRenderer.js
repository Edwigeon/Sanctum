export class PotionRenderer {
  constructor() {
    this.hpPotCanvas = null;
    this.mpPotCanvas = null;
  }

  ensureHpCanvas() {
    if (!this.hpPotCanvas && typeof document !== 'undefined') {
      this.hpPotCanvas = document.createElement('canvas');
      this.hpPotCanvas.width = 36;
      this.hpPotCanvas.height = 52;
    }
    return this.hpPotCanvas;
  }

  ensureMpCanvas() {
    if (!this.mpPotCanvas && typeof document !== 'undefined') {
      this.mpPotCanvas = document.createElement('canvas');
      this.mpPotCanvas.width = 36;
      this.mpPotCanvas.height = 52;
    }
    return this.mpPotCanvas;
  }

  drawLifePotion(ctx, x, y, w, h, s, animTime, state) {
    const canvas = this.ensureHpCanvas();
    if (!canvas) return;

    const PW = 36;
    const PH = 52;
    const oCtx = canvas.getContext('2d');
    oCtx.clearRect(0, 0, PW, PH);

    const ratio = Math.max(0, Math.min(1, state.hp / (state.maxHp || 100)));
    const fillH = Math.round(34 * ratio);
    const liquidTop = 46 - fillH;

    const bcx = 17.5;
    const bcy = 30.0;
    const Rx = 15.2;
    const Ry = 16.5;

    for (let py = 0; py < PH; py++) {
      for (let px = 0; px < PW; px++) {
        const dx = px - bcx;

        // 1. Top Stopper (Classic Cork Plug)
        if (py < 6) {
          if (py >= 2 && Math.abs(dx) <= (py <= 3 ? 3.5 : 3.0)) {
            if (dx < -1.5) {
              oCtx.fillStyle = '#ab5236'; // Warm cork highlight
            } else if (dx <= 0.5) {
              oCtx.fillStyle = (py === 3) ? '#dfa448' : '#8f4024'; // Body/accent
            } else {
              oCtx.fillStyle = '#561e12'; // Shadow
            }
            oCtx.fillRect(px, py, 1, 1);
          }
          continue;
        }

        // 2. Rolled Glass Collar / Lip
        if (py >= 6 && py <= 7) {
          if (Math.abs(dx) <= 4.8) {
            if (dx < -2) {
              oCtx.fillStyle = '#94a3b8'; // Specular rim reflection
            } else if (dx > 2) {
              oCtx.fillStyle = '#10131c'; // Rim shadow
            } else {
              oCtx.fillStyle = '#353d52'; // Mid glass
            }
            oCtx.fillRect(px, py, 1, 1);
          }
          continue;
        }

        // 3. Short Neck & Bulbous Bottom Silhouette
        let hw = 0;
        if (py >= 8 && py <= 46) {
          if (py <= 11) {
            hw = 3.8;
          } else {
            const dy = (py - bcy) / Ry;
            const term = 1 - dy * dy;
            const bulbW = term > 0 ? Rx * Math.sqrt(term) : 0;
            if (py <= 16) {
              const t = (py - 11) / 5.0;
              const b16 = Rx * Math.sqrt(1 - Math.pow((16 - bcy) / Ry, 2));
              hw = 3.8 + t * (b16 - 3.8);
            } else {
              hw = bulbW;
            }
          }
        }

        // 4. Elaborate Gothic Brass Pedestal & Claws
        const isClawLeft = (py >= 36 && py <= 44 && dx < 0 && Math.abs(dx) >= hw - 1.2 && Math.abs(dx) <= hw + 1.8 && !(py === 36 && Math.abs(dx) > hw + 0.2));
        const isClawRight = (py >= 36 && py <= 44 && dx > 0 && Math.abs(dx) >= hw - 1.2 && Math.abs(dx) <= hw + 1.8 && !(py === 36 && Math.abs(dx) > hw + 0.2));
        const isCollar = (py >= 44 && py <= 45 && Math.abs(dx) <= 13.5);
        const isWaist = (py >= 46 && py <= 47 && Math.abs(dx) <= 11.5);
        const isBevel = (py >= 48 && py <= 49 && Math.abs(dx) <= (py === 48 ? 13.5 : 15.5));
        const isPlinth = (py >= 50 && py <= 51 && Math.abs(dx) <= 16.5);

        if (isClawLeft) {
          if (Math.abs(dx) >= hw + 0.6 || py === 36) {
            oCtx.fillStyle = '#fff1e8'; // Outer gilded ridge glint
          } else if (Math.abs(dx) >= hw - 0.2) {
            oCtx.fillStyle = '#dfa448'; // Antique brass body
          } else {
            oCtx.fillStyle = '#8f4024'; // Inner bronze shadow against glass
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isClawRight) {
          if (Math.abs(dx) >= hw + 0.6) {
            oCtx.fillStyle = '#242a3a'; // Dark steel edge
          } else if (Math.abs(dx) >= hw - 0.2) {
            oCtx.fillStyle = '#7e2553'; // Shadowed bronze
          } else {
            oCtx.fillStyle = '#10131c'; // Deep cast shadow
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isCollar) {
          const isStud = py === 44 && (Math.abs(dx - (-7)) <= 1 || Math.abs(dx) <= 1 || Math.abs(dx - 7) <= 1);
          if (isStud) {
            oCtx.fillStyle = (dx <= 0) ? '#fff1e8' : '#dfa448';
          } else if (py === 44) {
            oCtx.fillStyle = (dx < 0) ? '#dfa448' : (dx > 5 ? '#242a3a' : '#8f4024');
          } else {
            oCtx.fillStyle = (dx < 0) ? '#242a3a' : '#10131c';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isWaist) {
          if (Math.abs(dx) <= 2.5) {
            if (Math.abs(dx) <= 1 && py === 46) {
              oCtx.fillStyle = '#ff004d'; // Inset ruby jewel
            } else if (Math.abs(dx) <= 1 && py === 47) {
              oCtx.fillStyle = '#7e2553'; // Jewel shadow
            } else {
              oCtx.fillStyle = '#dfa448'; // Bezel ring
            }
          } else {
            const fluted = (Math.round(Math.abs(dx)) % 2 === 0);
            oCtx.fillStyle = fluted ? ((dx < 0) ? '#353d52' : '#181d29') : ((dx < 0) ? '#242a3a' : '#0a0c12');
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isBevel) {
          if (py === 48) {
            oCtx.fillStyle = (dx < -4) ? '#fff1e8' : (dx < 2 ? '#dfa448' : (dx > 8 ? '#181d29' : '#8f4024'));
          } else {
            oCtx.fillStyle = (dx < 0) ? '#2d3244' : '#10131c';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isPlinth) {
          if (py === 50) {
            const isCornerFoot = Math.abs(dx) >= 12;
            oCtx.fillStyle = isCornerFoot ? ((dx < 0) ? '#dfa448' : '#353d52') : ((dx < 0) ? '#242a3a' : '#181d29');
          } else {
            oCtx.fillStyle = '#06070a';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (Math.abs(dx) > hw) continue;

        // Glass Outer Wall
        const distToEdge = hw - Math.abs(dx);
        if (distToEdge <= 1.8) {
          oCtx.fillStyle = (dx < 0 && py < 30) ? '#616e8e' : (dx > 0 ? '#05060a' : '#181d29');
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        // Liquid Interior
        const wave = Math.round(Math.sin((px + animTime * 14) * 0.45) * 0.85);
        const surfY = liquidTop + wave;

        if (py >= surfY) {
          if (py <= surfY + 1) {
            oCtx.fillStyle = (px % 2 === 0) ? '#ff77a8' : '#fff1e8';
          } else {
            const bayer = (px % 2) ^ (py % 2);
            const depth = (py - surfY) / Math.max(1, 46 - surfY);
            let col = depth < 0.4 ? '#ff004d' : (bayer ? '#ff004d' : '#7e2553');

            const b1 = Math.round((animTime * 18) % 24);
            if (px === 13 && py === 44 - b1) col = '#fff1e8';
            const b2 = Math.round((animTime * 14 + 10) % 22);
            if (px === 22 && py === 43 - b2) col = '#ff77a8';
            const b3 = Math.round((animTime * 20 + 5) % 25);
            if (px === 17 && py === 44 - b3) col = '#ffa300';

            oCtx.fillStyle = col;
          }
          oCtx.fillRect(px, py, 1, 1);
        }

        // Specular highlight streak down short neck
        if (py >= 8 && py <= 12 && dx === -1.5) {
          oCtx.fillStyle = '#fff1e8';
          oCtx.fillRect(px, py, 1, 1);
        }

        // Specular Arc Glint on upper-left curve of bulbous belly
        if (dx <= -4 && dx >= -12 && py >= 16 && py <= 28) {
          const dy = (py - bcy) * (Rx / Ry);
          const dist = Math.hypot(dx, dy);
          if (Math.abs(dist - 11.5) <= 0.9) {
            oCtx.fillStyle = '#fff1e8';
            oCtx.fillRect(px, py, 1, 1);
          }
        }
      }
    }

    // Stamp pixelated flask to stage canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, y, w, h);

    // Text Overlays
    const cx = x + w / 2;
    const cy = y + h * 0.48;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const valText = `${state.hp}`;
    const maxText = `/${state.maxHp}`;
    ctx.font = `bold ${Math.max(20, Math.round(26 * s))}px monospace`;

    ctx.fillStyle = '#000000';
    ctx.fillText(valText, cx + 2, cy + 2);
    ctx.fillText(valText, cx - 2, cy + 2);
    ctx.fillText(valText, cx + 2, cy - 2);
    ctx.fillText(valText, cx - 2, cy - 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(valText, cx, cy);

    ctx.font = `bold ${Math.max(10, Math.round(13 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(maxText, cx + 1.5, y + h * 0.68 + 1.5);
    ctx.fillStyle = '#fca5a5';
    ctx.fillText(maxText, cx, y + h * 0.68);

    ctx.restore();
  }

  drawManaPotion(ctx, x, y, w, h, s, animTime, state) {
    const canvas = this.ensureMpCanvas();
    if (!canvas) return;

    const PW = 36;
    const PH = 52;
    const oCtx = canvas.getContext('2d');
    oCtx.clearRect(0, 0, PW, PH);

    const ratio = Math.max(0, Math.min(1, state.mp / (state.maxMp || 50)));
    const fillH = Math.round(32 * ratio);
    const liquidTop = 46 - fillH;

    const bcx = 17.5;

    for (let py = 0; py < PH; py++) {
      for (let px = 0; px < PW; px++) {
        const dx = px - bcx;

        // 1. Top Crown & Runic Cap
        if (py < 6) {
          if (Math.abs(dx) <= 3.5) {
            if (py <= 2) {
              oCtx.fillStyle = (dx === 0) ? '#fff1e8' : '#22d3ee';
            } else {
              oCtx.fillStyle = (dx < 0) ? '#c2c3c7' : (dx === 0 ? '#fff1e8' : '#83769c');
            }
            oCtx.fillRect(px, py, 1, 1);
          }
          continue;
        }

        // 2. Collar & Neck
        if (py >= 6 && py <= 13) {
          if (py === 6) {
            if (Math.abs(dx) <= 5.5) {
              oCtx.fillStyle = (dx < -2) ? '#fff1e8' : (dx > 2 ? '#181d29' : '#83769c');
              oCtx.fillRect(px, py, 1, 1);
            }
            continue;
          }
          if (Math.abs(dx) <= 4.5) {
            if (Math.abs(dx) >= 3.5) {
              oCtx.fillStyle = (dx < 0) ? '#83769c' : '#1d2b53';
              oCtx.fillRect(px, py, 1, 1);
            } else if (dx === -2.5) {
              oCtx.fillStyle = '#fff1e8';
              oCtx.fillRect(px, py, 1, 1);
            } else if (py >= liquidTop) {
              oCtx.fillStyle = '#29adff';
              oCtx.fillRect(px, py, 1, 1);
            }
          }
          continue;
        }

        // 3. Faceted Crystalline Phial Body
        let hw = 0;
        if (py >= 14 && py <= 20) {
          const t = (py - 14) / 6.0;
          hw = 4.5 + t * 10.5;
        } else if (py >= 21 && py <= 32) {
          hw = 15.0;
        } else if (py >= 33 && py <= 49) {
          const t = (py - 33) / 16.0;
          hw = Math.max(1.5, 15.0 - t * 13.5);
        }

        // 4. Elaborate Gothic Midnight-Iron & Platinum Pedestal
        const phialHw = (py >= 33 && py <= 44) ? Math.max(1.5, 15.0 - ((py - 33) / 16.0) * 13.5) : hw;
        const isClawLeft = (py >= 36 && py <= 44 && dx < 0 && Math.abs(dx) >= phialHw - 1.2 && Math.abs(dx) <= phialHw + 1.8 && !(py === 36 && Math.abs(dx) > phialHw + 0.2));
        const isClawRight = (py >= 36 && py <= 44 && dx > 0 && Math.abs(dx) >= phialHw - 1.2 && Math.abs(dx) <= phialHw + 1.8 && !(py === 36 && Math.abs(dx) > phialHw + 0.2));
        const isCollar = (py >= 44 && py <= 45 && Math.abs(dx) <= 13.5);
        const isWaist = (py >= 46 && py <= 47 && Math.abs(dx) <= 11.5);
        const isBevel = (py >= 48 && py <= 49 && Math.abs(dx) <= (py === 48 ? 13.5 : 15.5));
        const isPlinth = (py >= 50 && py <= 51 && Math.abs(dx) <= 16.5);

        if (isClawLeft) {
          if (Math.abs(dx) >= phialHw + 0.6 || py === 36) {
            oCtx.fillStyle = '#fff1e8'; // Outer silver ridge glint
          } else if (Math.abs(dx) >= phialHw - 0.2) {
            oCtx.fillStyle = '#c2c3c7'; // Polished silver body
          } else {
            oCtx.fillStyle = '#5f574f'; // Shadow against crystal
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isClawRight) {
          if (Math.abs(dx) >= phialHw + 0.6) {
            oCtx.fillStyle = '#1e2436'; // Dark steel edge
          } else if (Math.abs(dx) >= phialHw - 0.2) {
            oCtx.fillStyle = '#38435d'; // Shadowed steel
          } else {
            oCtx.fillStyle = '#10131c'; // Deep shadow
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isCollar) {
          const isStud = py === 44 && (Math.abs(dx - (-7)) <= 1 || Math.abs(dx) <= 1 || Math.abs(dx - 7) <= 1);
          if (isStud) {
            oCtx.fillStyle = (dx <= 0) ? '#67e8f9' : '#22d3ee'; // Runic sapphire studs
          } else if (py === 44) {
            oCtx.fillStyle = (dx < 0) ? '#c2c3c7' : (dx > 5 ? '#242a3a' : '#5f574f');
          } else {
            oCtx.fillStyle = (dx < 0) ? '#1e2436' : '#10131c';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isWaist) {
          if (Math.abs(dx) <= 2.5) {
            if (Math.abs(dx) <= 1 && py === 46) {
              oCtx.fillStyle = '#22d3ee'; // Glowing cyan mana rune
            } else if (Math.abs(dx) <= 1 && py === 47) {
              oCtx.fillStyle = '#0284c7'; // Gem shadow
            } else {
              oCtx.fillStyle = '#c2c3c7'; // Silver bezel
            }
          } else {
            const fluted = (Math.round(Math.abs(dx)) % 2 === 0);
            oCtx.fillStyle = fluted ? ((dx < 0) ? '#38435d' : '#181d29') : ((dx < 0) ? '#1e2436' : '#0a0c12');
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isBevel) {
          if (py === 48) {
            oCtx.fillStyle = (dx < -4) ? '#fff1e8' : (dx < 2 ? '#c2c3c7' : (dx > 8 ? '#181d29' : '#5f574f'));
          } else {
            oCtx.fillStyle = (dx < 0) ? '#242a3a' : '#10131c';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (isPlinth) {
          if (py === 50) {
            const isCornerFoot = Math.abs(dx) >= 12;
            oCtx.fillStyle = isCornerFoot ? ((dx < 0) ? '#c2c3c7' : '#242a3a') : ((dx < 0) ? '#1e2436' : '#10131c');
          } else {
            oCtx.fillStyle = '#06070a';
          }
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        if (Math.abs(dx) > hw) continue;

        // Outer Crystal Facet Boundary
        const distToEdge = hw - Math.abs(dx);
        if (distToEdge <= 1.6) {
          oCtx.fillStyle = (dx < 0) ? '#67e8f9' : '#05060a';
          oCtx.fillRect(px, py, 1, 1);
          continue;
        }

        // Facet Bevel Ridges (hexagonal facets at dx = -6 and dx = 6)
        const isFacetRidge = (Math.abs(dx) >= 5.5 && Math.abs(dx) <= 6.5);

        // Liquid Interior
        const wave = Math.round(Math.sin((px + animTime * 14) * 0.45) * 0.85);
        const surfY = liquidTop + wave;

        if (py >= surfY) {
          if (py <= surfY + 1) {
            oCtx.fillStyle = (px % 2 === 0) ? '#67e8f9' : '#fff1e8';
          } else {
            const bayer = (px % 2) ^ (py % 2);
            const depth = (py - surfY) / Math.max(1, 46 - surfY);
            let col = depth < 0.4 ? '#29adff' : (bayer ? '#29adff' : '#1d2b53');

            if (isFacetRidge && py > surfY + 2) {
              col = dx < 0 ? '#67e8f9' : '#10172a';
            }

            const b1 = Math.round((animTime * 18) % 24);
            if (px === 13 && py === 44 - b1) col = '#fff1e8';
            const b2 = Math.round((animTime * 14 + 10) % 22);
            if (px === 22 && py === 43 - b2) col = '#67e8f9';
            const b3 = Math.round((animTime * 20 + 5) % 25);
            if (px === 17 && py === 44 - b3) col = '#a5f3fc';

            oCtx.fillStyle = col;
          }
          oCtx.fillRect(px, py, 1, 1);
        } else if (isFacetRidge) {
          oCtx.fillStyle = 'rgba(103, 232, 249, 0.25)';
          oCtx.fillRect(px, py, 1, 1);
        }

        // Prismatic Gleam
        if (dx === -6 && py >= 15 && py <= 32) {
          if (py % 4 <= 1) {
            oCtx.fillStyle = '#fff1e8';
            oCtx.fillRect(px, py, 1, 1);
          }
        }
      }
    }

    // Stamp pixelated phial to stage canvas
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, y, w, h);

    // Text Overlays
    const cx = x + w / 2;
    const cy = y + h * 0.48;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const valText = `${state.mp}`;
    const maxText = `/${state.maxMp}`;
    ctx.font = `bold ${Math.max(20, Math.round(26 * s))}px monospace`;

    ctx.fillStyle = '#000000';
    ctx.fillText(valText, cx + 2, cy + 2);
    ctx.fillText(valText, cx - 2, cy + 2);
    ctx.fillText(valText, cx + 2, cy - 2);
    ctx.fillText(valText, cx - 2, cy - 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(valText, cx, cy);

    ctx.font = `bold ${Math.max(10, Math.round(13 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(maxText, cx + 1.5, y + h * 0.68 + 1.5);
    ctx.fillStyle = '#a5f3fc';
    ctx.fillText(maxText, cx, y + h * 0.68);

    ctx.restore();
  }
}

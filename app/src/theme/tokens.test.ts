import fs from 'fs';
import path from 'path';
import { colors, heatColors, layout, radii } from './tokens';

describe('design tokens', () => {
  it('match the brief and previews', () => {
    expect(colors.ground).toBe('#F3F4F1');
    expect(colors.ink).toBe('#16181D');
    expect(colors.muted).toBe('#5B616B');
    expect(colors.card).toBe('#FFFFFF');
    expect([colors.heat1, colors.heat2, colors.heat3]).toEqual(['#FFE9C7', '#FFC46B', '#F08A1D']);
    expect(colors.accentText).toBe('#B4530A');
    expect([colors.tileNew, colors.tileMid, colors.tileOld]).toEqual(['#DDE0D8', '#C6CAC1', '#A6AB9F']);
    expect([colors.border, colors.borderSoft]).toEqual(['#C9CCC4', '#E4E6E0']);
    expect(heatColors).toEqual([null, '#FFE9C7', '#FFC46B', '#F08A1D']);
  });

  it('keep the radii and touch target from the previews', () => {
    expect(radii).toMatchObject({ card: 20, button: 16, pill: 999, tile: 7 });
    expect(layout.minTouch).toBeGreaterThanOrEqual(44);
  });
});

describe('web page template (public/index.html)', () => {
  it('paints the page behind the app in the ground color', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8').toLowerCase();
    expect(html).toContain(`background-color: ${colors.ground.toLowerCase()}`);
    expect(html).toContain(`<meta name="theme-color" content="${colors.ground.toLowerCase()}"`);
    expect(html).toContain('<div id="root"></div>');
  });
});

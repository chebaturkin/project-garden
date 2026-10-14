"""PNG text and specimens retain the export's starting language across awaits."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('APP_URL', 'http://127.0.0.1:4421/')

with sync_playwright() as p:
    browser = p.chromium.launch()
    for delay in ['images', 'fonts']:
        context = browser.new_context(locale='en-US', accept_downloads=True, viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL.rstrip('/') + '/?lang=en', wait_until='networkidle')
        expect(page.locator('.plant-button')).to_have_count(5)
        page.evaluate('''kind => {
          window.exportText = []; window.exportSources = []; window.exportImagesStarted = 0;
          const createUrl = URL.createObjectURL;
          URL.createObjectURL = function(blob) {
            if (blob.type === 'image/svg+xml') exportSources.push(blob.text());
            return createUrl.call(this, blob);
          };
          const fill = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
            exportText.push(String(text)); return fill.call(this, text, ...args);
          };
          const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
          Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true, get: src.get, set(value) {
              window.exportImagesStarted++; setTimeout(() => src.set.call(this, value), 150);
            }
          });
          if (kind === 'fonts') Object.defineProperty(document.fonts, 'ready', {
            value: new Promise(resolve => window.releaseExportFonts = resolve)
          });
        }''', delay)
        with page.expect_download() as download:
            page.locator('#export-png').evaluate('(node) => node.click()')
            if delay == 'images':
                page.wait_for_function('window.exportImagesStarted > 0')
            else:
                page.wait_for_function('!!window.releaseExportFonts')
            page.locator('[data-language="ru"]').evaluate('(node) => node.click()')
            expect(page.locator('html')).to_have_attribute('lang', 'ru')
            assert 'сайт студии' in page.locator('#plants-layer').inner_text()
            if delay == 'fonts':
                page.evaluate('window.releaseExportFonts()')
        assert download.value.suggested_filename.endswith('.png')
        assert Path(download.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
        drawn = page.evaluate('window.exportText')
        assert 'studio website' in drawn and 'field notes' in drawn, (delay, drawn)
        assert 'a place for every project' in drawn, (delay, drawn)
        assert not re.search('[а-яёА-ЯЁ]', ' '.join(drawn)), (delay, drawn)
        sources = page.evaluate('Promise.all(window.exportSources)')
        assert len(sources) == 5 and 'studio website' in sources[0], (delay, sources)
        assert not re.search('[а-яёА-ЯЁ]', ''.join(sources)), (delay, sources)
        assert page.locator('html').get_attribute('lang') == 'ru'
        assert not errors, errors
        print('garden ' + delay + ' delay: PNG keeps the starting language and demo names')
        context.close()
    browser.close()

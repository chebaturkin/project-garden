"""Capture the live garden in both languages, including exported PNG and growth GIF."""
import importlib.util,os
from pathlib import Path
from playwright.sync_api import sync_playwright
spec=importlib.util.spec_from_file_location('garden_checks',Path(__file__).with_name('verify-browser.py'))
checks=importlib.util.module_from_spec(spec);spec.loader.exec_module(checks)
url=os.environ.get('APP_URL','http://127.0.0.1:4421/')
with sync_playwright() as p:
 browser=p.chromium.launch()
 for language in ['ru','en']:checks.captures(browser,url.rstrip('/')+'/?lang='+language,language)
 browser.close()

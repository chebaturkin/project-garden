"""Browser regression checks and real README captures.
Run a static server first, then: python3 scripts/verify-browser.py --url http://localhost:4179 --capture
Requires playwright; captures additionally use pillow.
"""
import argparse
import io
import json
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)
DAY = timedelta(days=1)

def iso(days=0):
    return (NOW - DAY * days).isoformat()

def fixture(index=0, **overrides):
    return {"id": f"specimen-{index}", "name": f"растение {index + 1}", "status": "active", "color": "#718b6a", "createdAt": iso(60), "updatedAt": iso(2), "growthDays": 0, "growthStartedAt": iso(60), **overrides}

def new_page(browser, url, projects=None, width=1440, motion="no-preference"):
    context = browser.new_context(viewport={"width": width, "height": 1050}, reduced_motion=motion, locale="ru-RU", timezone_id="Europe/Moscow")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if projects is not None:
        envelope = {"schemaVersion": 2, "revision": 10, "savedAt": iso(), "projects": projects}
        page.add_init_script("if (!localStorage.getItem('project-garden')) localStorage.setItem('project-garden', " + json.dumps(json.dumps(envelope, ensure_ascii=False)) + ");")
    page.goto(url)
    page.wait_for_load_state("networkidle")
    expect(page.locator("#project-count")).not_to_have_text("0 растений") if projects else None
    page.wait_for_function("document.querySelector('#scene-date').textContent.length > 0")
    return context, page, errors

def download_json(page, tmp):
    with page.expect_download() as info:
        page.locator("#export-json").click()
    destination = Path(tmp) / info.value.suggested_filename
    info.value.save_as(destination)
    return json.loads(destination.read_text())

def checks(browser, url):
    with tempfile.TemporaryDirectory() as tmp:
        context, page, errors = new_page(browser, url, [fixture(0), fixture(1, status="sleeping", growthDays=20, growthStartedAt=iso(20)), fixture(2, status="archived", growthDays=48)])
        expect(page.locator(".plant-button")).to_have_count(3)
        assert page.title().startswith("project garden")
        page.locator(".plant-button").first.click()
        expect(page.locator("#growth-stage")).to_have_text("зрелое растение")
        page.locator("#project-note").fill("черновик остаётся на месте")
        page.locator("#project-sort").select_option("name")
        expect(page.locator("#project-note")).to_have_value("черновик остаётся на месте")
        # Selecting the same specimen keeps its SVG and current animation timeline.
        page.evaluate("window.savedSvg = document.querySelector('.plant-button.is-selected svg')")
        page.locator(".plant-button.is-selected").click()
        assert page.evaluate("savedSvg === document.querySelector('.plant-button.is-selected svg')")
        page.locator("#project-form button[type=submit]").click()
        expect(page.locator("#toast")).to_contain_text("сохранён")
        expect(page.locator("#growth-stage")).to_have_text("зрелое растение")
        page.reload(); page.wait_for_load_state("networkidle")
        page.locator('.plant-button[data-id="specimen-0"]').click()
        expect(page.locator("#project-note")).to_have_value("черновик остаётся на месте")
        page.locator("#project-status").select_option("sleeping")
        page.locator("#project-form button[type=submit]").click()
        expect(page.locator("#growth-stage")).to_have_text("рост на паузе")
        before = download_json(page, tmp)
        paused = next(item for item in before["projects"] if item["id"] == "specimen-0")
        assert paused["growthDays"] >= 60
        page.locator("#project-status").select_option("active")
        page.locator("#project-form button[type=submit]").click()
        expect(page.locator("#growth-stage")).to_have_text("зрелое растение")
        before_preview = page.evaluate("localStorage.getItem('project-garden')")
        page.locator("#preview-growth").click()
        page.locator("#growth-slider").fill("0")
        expect(page.locator("#growth-preview-stage")).to_have_text("росток")
        page.locator("#growth-slider").fill("90")
        expect(page.locator("#growth-preview-stage")).to_have_text("зрелое растение")
        page.keyboard.press("Escape")
        expect(page.locator("#growth-dialog")).not_to_be_visible()
        expect(page.locator("#project-form")).to_be_visible()
        assert page.evaluate("localStorage.getItem('project-garden')") == before_preview
        page.locator("#motion-toggle").click()
        expect(page.locator("html")).to_have_attribute("data-motion", "off")
        page.reload(); page.wait_for_load_state("networkidle")
        expect(page.locator("html")).to_have_attribute("data-motion", "off")
        page.locator('[data-filter="archived"]').click()
        page.locator("#project-search").fill("несуществующий проект")
        expect(page.locator("#garden-empty")).to_be_visible()
        page.locator("#add-project").click()
        expect(page.locator("#project-form")).to_be_visible()
        page.locator("#project-name").fill("новый проект")
        page.locator("#project-next-step").fill("собрать первую страницу")
        page.locator("#project-form button[type=submit]").click()
        expect(page.locator(".plant-button")).to_have_count(4)
        page.locator("#duplicate-project").click()
        expect(page.locator("#project-name")).to_have_value("новый проект (копия)")
        expect(page.locator("#growth-days")).to_have_text("0 дн. активного роста")
        page.locator("#project-form button[type=submit]").click()
        expect(page.locator(".plant-button")).to_have_count(5)
        # JSON clock round trip and safe ZIP metadata.
        payload = download_json(page, tmp)
        page.locator("#file-input").set_input_files({"name": "garden.json", "mimeType": "application/json", "buffer": json.dumps(payload).encode()})
        expect(page.locator(".plant-button")).to_have_count(10)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("notes/readme.md", "text")
            z.writestr("photo.png", "metadata only")
            z.writestr("../unsafe.txt", "reject")
        page.locator("#file-input").set_input_files({"name": "field.zip", "mimeType": "application/zip", "buffer": archive.getvalue()})
        expect(page.locator(".plant-button")).to_have_count(11)
        imported = download_json(page, tmp)
        zip_project = next(item for item in imported["projects"] if item["source"] == "zip")
        assert len(zip_project["files"]) == 2
        page.locator("#file-input").set_input_files({"name": "broken.zip", "mimeType": "application/zip", "buffer": b"broken"})
        expect(page.locator("#toast")).to_contain_text("повреждён")
        expect(page.locator(".plant-button")).to_have_count(11)
        with page.expect_download() as info:
            page.locator("#export-png").click()
        png = Path(tmp) / "garden.png"
        info.value.save_as(png)
        assert png.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        assert png.stat().st_size > 20000
        assert not errors, errors
        context.close()

        # A deliberately empty garden stays empty after a reload.
        context, page, errors = new_page(browser, url, [fixture(0)])
        page.on("dialog", lambda dialog: dialog.accept())
        page.locator(".plant-button").click()
        page.locator("#delete-project").click()
        expect(page.locator("#garden-empty")).to_be_visible()
        page.reload(); page.wait_for_load_state("networkidle")
        expect(page.locator(".plant-button")).to_have_count(0)
        expect(page.locator("#garden-empty")).to_be_visible()
        assert not errors, errors
        context.close()

        # Each species gets taller across maturity boundaries, including the tree.
        context, page, errors = new_page(browser, url, [fixture(0)], motion="reduce")
        heights = page.evaluate("""async () => {
            const { plantSvg } = await import('./plants.js');
            const now = Date.now();
            const box = document.createElement('div');
            document.body.append(box);
            const result = ['a', 'b', 'c', 'd'].map(id => [13.999, 14, 44.999, 45].map(days => {
                box.innerHTML = plantSvg({id, status:'active', growthDays:days, growthStartedAt:new Date(now).toISOString()}, false, now);
                return box.querySelector('.plant-growth').getBoundingClientRect().height;
            }));
            box.remove();
            return result;
        }""")
        for species in heights:
            assert all(a <= b for a, b in zip(species, species[1:])), species
        assert not errors, errors
        context.close()

        # Native keyboard selection retains a visible focus target.
        context, page, errors = new_page(browser, url, [fixture(0)])
        page.locator(".plant-button").focus()
        page.keyboard.press("Enter")
        assert page.evaluate("document.activeElement.classList.contains('plant-button')")
        assert page.locator(".plant-button").evaluate("e => getComputedStyle(e).outlineStyle") != "none"
        page.locator("#preview-growth").click()
        page.keyboard.press("Tab")
        assert page.evaluate("document.activeElement.closest('dialog') !== null")
        assert not errors, errors
        context.close()

        # Large gardens grow into rows instead of clipping behind a single soil strip.
        large = [fixture(i, name="широкое название проекта которое приходится долго вспоминать") for i in range(500)]
        context, page, errors = new_page(browser, url, large)
        expect(page.locator(".plant-button")).to_have_count(500)
        assert page.locator("#plants-layer").bounding_box()["height"] > 5000
        assert page.locator(".plant-button.is-in-view").count() < 30
        for width in [1440, 1024, 768, 390, 320]:
            page.set_viewport_size({"width": width, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            assert page.locator(".plant-button").first.evaluate("e => e.querySelector('.plant-age').getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1"), width
        assert not errors, errors
        context.close()

        context, page, errors = new_page(browser, url, [fixture(0)], width=320, motion="reduce")
        expect(page.locator("html")).to_have_attribute("data-motion", "off")
        expect(page.locator("#motion-toggle")).to_be_disabled()
        assert page.locator(".plant-sway").first.evaluate("e => getComputedStyle(e).animationName") == "none"
        page.locator(".plant-button").click()
        expect(page.locator("#project-form")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not errors, errors
        context.close()
    print("browser checks passed: growth, persistence, drafts, filters, imports, exports, keyboard, 500 plants, 320–1440 px, reduced motion")

def captures(browser, url, language="ru"):
    from PIL import Image
    output = ROOT / "docs/images" / ("en" if language == "en" else "")
    output.mkdir(exist_ok=True, parents=True)
    context, page, errors = new_page(browser, url)
    page.screenshot(path=str(output / "garden.png"), full_page=True, animations="disabled")
    page.locator(".plant-button").first.click()
    page.wait_for_timeout(500)
    page.locator(".inspector-panel").screenshot(path=str(output / "passport.png"), animations="disabled")
    with page.expect_download() as info:
        page.locator("#export-png").click()
    info.value.save_as(output / "snapshot.png")
    page.locator("#preview-growth").click()
    page.wait_for_timeout(500)
    page.locator("#growth-slider").fill("45")
    page.wait_for_timeout(450)
    page.locator("#growth-dialog").screenshot(path=str(output / "growth.png"), animations="disabled")
    frames = []
    # Real rendered UI frames, including slider changes and the botanical specimen.
    for days in [0, 0, 1, 3, 5, 8, 11, 14, 18, 24, 30, 38, 44, 45, 55, 65, 75, 90, 90, 90]:
        page.locator("#growth-slider").fill(str(days))
        page.wait_for_timeout(450)
        frames.append(Image.open(io.BytesIO(page.locator("#growth-dialog").screenshot())).convert("RGB"))
    frames[0].save(output / "growth.gif", save_all=True, append_images=frames[1:], duration=220, loop=0, optimize=True)
    assert not errors, errors
    context.close()
    context, page, errors = new_page(browser, url, width=390)
    page.screenshot(path=str(output / "mobile.png"), full_page=True, animations="disabled")
    assert not errors, errors
    context.close()
    print("README captures saved to docs/images")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4179")
    parser.add_argument("--capture", action="store_true")
    args = parser.parse_args()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            checks(browser, args.url)
            if args.capture:
                captures(browser, args.url)
        finally:
            browser.close()

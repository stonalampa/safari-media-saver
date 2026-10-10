# Safari Media Saver

A small Safari Web Extension that adds a **⬇ save** button to Instagram — posts, reels, stories and highlights — so you can keep the photo or video you're looking at with one click.

> Status: early work in progress — Instagram only. Facebook is planned next.

## How it works (and why it's account-safe)

- The page already downloads JSON describing every post you scroll past, including direct CDN links to the full-size photo or video.
- `interceptor.js` runs in the page and *observes* those responses (`fetch`, `XMLHttpRequest`, inline `<script>` data). It never sends a request of its own.
- When you click ⬇, the file is fetched from the CDN (`*.cdninstagram.com` / `*.fbcdn.net`) — the same signed URL the page uses to show it to you — and saved to Downloads.

What it deliberately does **not** do:

- No calls to Instagram/Facebook APIs and no use of your cookies outside the browser.
- No "download whole profile" or any bulk mode. One click saves the post on screen (all slides, for a carousel) or the current story.
- No telemetry, no external servers.

This is a tool for personally saving the occasional post, not a scraper.

## Project layout

```
extension/            Web extension source (Manifest V3)
  manifest.json
  src/interceptor.js  MAIN world: observes page data, extracts media URLs
  src/content.js      Isolated world: buttons + downloads
  src/content.css
xcode/                Wrapper macOS app required by Safari (generated with
                      safari-web-extension-converter; references extension/ directly)
```

## Running it (Safari, macOS)

Requires Xcode.

1. Open `xcode/Safari Media Saver/Safari Media Saver.xcodeproj` and press **⌘R**, or build from the command line:
   ```sh
   cd "xcode/Safari Media Saver"
   xcodebuild -scheme "Safari Media Saver" -configuration Debug -derivedDataPath ../../build build
   open "../../build/Build/Products/Debug/Safari Media Saver.app"
   ```
   Running the app once registers the extension with Safari.
2. In Safari: **Settings → Advanced → Show features for web developers**, then **Develop → Developer Settings → Allow unsigned extensions**. Safari resets this every time it quits.
3. **Settings → Extensions →** enable *Safari Media Saver* and allow it on `www.instagram.com`.
4. Open Instagram and click ⬇ on a post. On the first save, allow downloads for instagram.com.

Edits to files in `extension/` need a rebuild (⌘R) to show up in Safari.

The same `extension/` folder also loads as an unpacked extension in Chromium-based browsers (`chrome://extensions` → Developer mode → Load unpacked).

## License

TBD

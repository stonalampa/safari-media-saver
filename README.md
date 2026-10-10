# Safari Media Saver

A small Safari Web Extension that adds a **⬇ save** button to Instagram and Facebook, so you can keep the photo or video you're looking at with one click — no paid extension, no third-party website, no logging in anywhere else.

**Instagram**

| Where you are   | What ⬇ saves                               |
| --------------- | ------------------------------------------ |
| Feed            | The post most visible on screen            |
| Post / carousel | The post — every slide of a carousel       |
| Reel            | The reel video                             |
| Story           | The story currently shown (photo or video) |
| Highlight       | The highlight item currently shown         |

**Facebook**

| Where you are         | What ⬇ saves                        |
| --------------------- | ----------------------------------- |
| Photo viewer          | The open photo, full size           |
| Video / Watch / Reel  | The video, in HD when available     |
| Story / highlight     | The item currently shown            |
| Feed                  | The photo or video on screen        |

Files land in your Downloads folder as `<owner>_<id>.jpg` / `.mp4` (carousels get `_1`, `_2`, … suffixes).

## Design

### The idea

Everything you see on Instagram or Facebook has already been downloaded by your browser. The full-size photo, the video and the story are all sitting in data the page received to show them to you. Saving one of them shouldn't need a paid extension, a third-party website that asks for your login, or a tool that talks to Meta's servers behind your back. It should be one click on what's already there.

So the extension is built around one rule: **observe, never request**. It reads what the page already loaded and saves the file you're looking at. Nothing else.

### Non-goals

What it deliberately does *not* do matters as much as what it does. Each of these was a conscious choice:

| Not built                          | Why                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Calls to Instagram/Facebook APIs   | Tools like `yt-dlp` or `instaloader` query the API with your session cookies from a non-browser client — the traffic pattern that triggers "suspicious activity" checks. Passive observation adds nothing for the platform to detect. |
| Bulk / profile download            | One click saves what's on screen. No "download all", no background crawling, no queue. Bulk collection is what scraping is; this isn't that. |
| Anonymous story viewing            | You can only save a story by watching it, which puts you in the owner's viewer list, exactly as when you watch it normally. The extension never hides who you are. |
| Access to anything you can't see   | No bypassing private accounts, logins or restrictions. If your account can't view it, the extension can't save it. |
| Servers, accounts, telemetry       | Nothing leaves your Mac except the download from the CDN. No data is collected, stored or sent anywhere. |

### How it works

You could do the same by hand: open Web Inspector's Network tab, find the file and save it. The extension automates that one step:

1. **Observe.** Instagram and Facebook pages receive JSON describing every post, reel, photo, video and story you scroll past, including direct CDN links to the full-size media. `interceptor.js` runs in the page and *reads* those responses (`fetch`, `XMLHttpRequest`, and the data embedded in the initial HTML). It never sends a request of its own.
2. **Match.** `content.js` works out what you're looking at: the post, photo, video or story id in the URL, the most visible post in the feed, or — where the URL doesn't identify the current item, as in highlights — the image/video on screen, matched by its CDN file name or (for streamed videos) by duration, read from the video's DASH manifest.
3. **Save.** On click, the file is fetched from the CDN (`*.cdninstagram.com` / `*.fbcdn.net`) using the signed link the page already had, *without* cookies, and saved via a regular browser download.

## Playing by the rules

The project was built to stay on the right side of both the law and the platforms' rules:

- **Only what you can already see.** The extension works inside your normal, logged-in session and never gets around privacy settings, private accounts, blocks or any other access control.
- **Transparent, not anonymous.** Using it leaves the same footprint as using the site: when you watch a story, its owner sees that you did. Functionally, it does what a screenshot or screen recording already does on every computer — only in original quality and with one click.
- **No scraping.** No automated collection, no crawling, no bulk downloads, no data sent to anyone. Every save is a single, deliberate click by a person looking at that content.
- **Your copy, your responsibility.** Saving a copy for yourself is one thing; reposting or redistributing someone else's photo or video needs their permission. Credit creators and respect their rights.

*This describes the project's intent and design; it is not legal advice.*

## Intended use

- **Your own content.** Keep your posts, stories, highlights and reels in full quality, instantly. No waiting for a "Download your information" export.
- **Creators and social media managers.** Archive published content for a portfolio, client reports or backups.
- **Family and friends.** Keep the photos and videos from an event that people shared with you.
- **Reference and inspiration.** Save a tutorial, recipe or design reference for yourself.
- **Keeping evidence.** Preserve a harassing post, scam ad or abusive story before it disappears, so it can be reported to the platform or the authorities.

**Not intended for** collecting other people's content without their knowledge, monitoring someone, or reposting work that isn't yours. The design leaves no room for bulk or hidden use, and that's on purpose.

## Install (macOS, Safari)

There is no App Store build — you build it yourself, for free. Requires **Xcode** (free, Mac App Store).

1. Clone the repo and build the app:
   ```sh
   git clone https://github.com/stonalampa/safari-media-saver.git
   cd "safari-media-saver/xcode/Safari Media Saver"
   xcodebuild -scheme "Safari Media Saver" -configuration Debug -derivedDataPath ../../build build
   open "../../build/Build/Products/Debug/Safari Media Saver.app"
   ```
   Or open `xcode/Safari Media Saver/Safari Media Saver.xcodeproj` in Xcode and press **⌘R**. Running the app once registers the extension with Safari.
2. In Safari: **Settings → Advanced → Show features for web developers**, then in the **Develop** menu enable **Allow Unsigned Extensions**.
3. **Settings → Extensions →** enable *Safari Media Saver* and allow it on `www.instagram.com` and `www.facebook.com`.
4. Open Instagram or Facebook and click ⬇ (bottom-right). On the first save, allow downloads for the site.

### Staying enabled after Safari restarts

Safari turns *Allow Unsigned Extensions* off every time it quits, which disables the extension until you switch it back on. To avoid that, sign the build with your own Apple ID: in Xcode, add your Apple ID under **Settings → Accounts**, then select your *Personal Team* under **Signing & Capabilities** for both targets (the app and the extension) and rebuild. A free Apple ID is enough for local use.

## Development

```
extension/              Web extension source (Manifest V3)
  manifest.json
  src/interceptor.js    Runs in the page: observes loaded JSON, extracts media URLs
  src/content.js        Content script: injects the interceptor, resolves what's on screen, downloads
  src/content.css       The ⬇ button
xcode/                  Wrapper macOS app that Safari requires (generated by
                        safari-web-extension-converter; references extension/ directly)
```

- Edit files in `extension/`, then rebuild (⌘R) and reload the Instagram/Facebook tab.
- Safari doesn't support `"world": "MAIN"` for content scripts, so `content.js` injects `interceptor.js` into the page via a `<script>` tag (listed in `web_accessible_resources`).
- Safari has no `downloads` API; saving uses a blob URL and an `<a download>` click.
- Debugging: open **Develop → Web Inspector** on the tab; the extension logs lines prefixed with `[safari-media-saver]`. If ⬇ shows **?**, it logs what it saw on screen and what media it knows about. On Facebook, the raw video objects it parsed are available in the page console as `__smsVideos`.

### Known limitations

- Instagram and Facebook change their internal data formats from time to time; when they do, saving may stop working until the parser is updated.
- Streamed videos whose URL doesn't identify them (highlights, some feed videos) are matched by duration. Two videos with (nearly) identical length can be confused.
- Saving many files in quick succession can get temporarily throttled by the CDN; waiting a bit and reloading fixes it.

## License

[MIT](LICENSE) © 2026 Milan Radanović

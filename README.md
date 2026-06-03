# 🎤 Karaoke Pro - Next-Gen Glass Experience

A premium, modern web-based Karaoke player designed with a sleek **Glassmorphism** aesthetic and an **Apple-style Dynamic Island** interface. Built for a seamless "Karaoke Box" experience directly in your browser.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **💎 Premium Glass UI:** Sophisticated glassmorphism design with blur effects, interactive shimmers, and smooth floating animations.
- **🏝️ Dynamic Island Header:** A smart, sticky header that reacts to playback states and displays "Now Playing" information.
- **🎙️ Hybrid Visualizer:** Real-time microphone audio visualization for singers, with an automatic "Simulation Mode" to keep the UI dynamic even when the mic is off.
- **💯 Performance Scoring System:** Evaluates vocal energy and rhythm matching. Includes a live floating score badge and a final overlay showing your rank (Legendary, Rockstar, etc.).
- **🎉 Custom Score Sounds:** Plays celebration or feedback sounds (`scoreSound.mp3`) when a song ends.
- **📋 Smart Queue System:** Add and manage songs with a beautiful "Up Next" card interface. The queue seamlessly auto-plays the next song the moment your score sound finishes.
- **🔍 Robust Search:** Integrated YouTube search with multiple fallback proxies (Invidious, AllOrigins) to ensure reliability and bypass CORS restrictions.
- **📈 SEO & Accessibility Optimized:** Fully compliant with Google Search Console standards. Features dynamically loaded JSON-LD schema (`seo.jsonld`), hidden screen-reader friendly elements (`aria-label`), clean canonical tags, and a highly performant separated asset structure.
- **⌨️ Power-User Shortcuts:** 
  - `Z` - Play
  - `X` - Pause
  - `C` - Restart
  - `B` - Cancel (Skip to Next)
  - `F` - Fullscreen
  - `Enter` - Search & Play
  - `Shift + Enter` - Search & Reserve

## 🚀 Getting Started

### Prerequisites
To use the search functionality reliably, it is recommended to add your own **YouTube Data API v3 Key** in the code:
1. Open `app.js`.
2. Find the constant `YOUTUBE_API_KEY`.
3. Replace the placeholder with your key.

### Installation
The project is built entirely with frontend technologies.
1. Download or clone this repository.
2. Ensure you have all the core files (`index.html`, `style.css`, `app.js`, `seo.jsonld`, `scoreSound.mp3`).
3. Run the project using a local development server (e.g., VS Code Live Server or Python HTTP Server) so that the `seo.jsonld` file can be dynamically fetched without browser security restrictions.
4. Open the local address in any modern web browser and start singing!

## 🛠️ Tech Stack
- **HTML5:** Semantic structure and accessibility-first markup.
- **CSS3:** Custom variables, Glassmorphism, hardware-accelerated animations, and responsive layout.
- **Vanilla JavaScript:** Core logic, YouTube IFrame API integration, Web Audio API, and modular event handling.
- **Canvas API:** High-performance real-time audio visualization.

## 🔐 Security & Protection
The application is designed to be hosted on static platforms like **GitHub Pages**. To protect your API key:
- Use **HTTP Referrer restrictions** in the Google Cloud Console.
- Restrict the key to only work on your specific `*.github.io` domain.

## 📜 License
This project is open-source and available under the [MIT License](LICENSE).

---
*Created with ❤️ by Randel*

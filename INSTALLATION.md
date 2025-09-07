# Installation Guide - Smart Cart Assistant

## Quick Start

1. **Create Icon Files** (Important)
   - Open `create_icons.html` in your web browser
   - Right-click each canvas and save as PNG with the correct filename:
     - `icons/icon16.png`
     - `icons/icon32.png`
     - `icons/icon48.png`
     - `icons/icon128.png`

2. **Install Extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select this folder (`addCartExtension`)

3. **Get OpenAI API Key**
   - Visit [OpenAI Platform](https://platform.openai.com/api-keys)
   - Create an account if needed
   - Generate a new API key
   - Copy the key (starts with `sk-`)

4. **Setup Extension**
   - Click the extension icon in Chrome toolbar
   - Paste your OpenAI API key
   - Navigate to Amazon.com and login
   - Start using the extension!

## Testing the Extension

1. Go to Amazon.com
2. Click the Smart Cart Assistant extension icon
3. Enter a test request: "Add a wireless mouse under $30"
4. Click "Search & Add to Cart"

## Common Issues

- **No icons showing**: Make sure you created the PNG icon files
- **Extension not loading**: Check for JavaScript errors in Chrome DevTools
- **API errors**: Verify your OpenAI API key is correct and has credits

## File Structure

```
addCartExtension/
├── manifest.json          # Extension configuration
├── popup.html             # Main interface
├── popup.css              # Styling
├── popup.js               # UI logic
├── content.js             # Amazon page interaction
├── background.js          # Background processes
├── create_icons.html      # Icon generator
├── icons/
│   ├── icon16.png         # 16x16 icon (create this)
│   ├── icon32.png         # 32x32 icon (create this)
│   ├── icon48.png         # 48x48 icon (create this)
│   ├── icon128.png        # 128x128 icon (create this)
│   ├── icon.svg           # Source SVG
│   └── README_ICONS.txt   # Icon instructions
├── README.md              # Main documentation
└── INSTALLATION.md        # This file
```

## Ready to Use!

Once you've completed these steps, your Smart Cart Assistant extension is ready to help you shop on Amazon with AI-powered natural language requests!

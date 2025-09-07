# Smart Cart Assistant 🛒

An AI-powered Chrome extension that helps you search for products and add them to your Amazon cart using natural language requests.

## Features

- **Natural Language Processing**: Describe what you want in plain English
- **AI-Powered Parsing**: Uses GPT-3.5 to understand your requirements (size, color, price, etc.)
- **Intelligent Search**: Automatically searches Amazon for matching products
- **Smart Cart Addition**: Adds the best matching products to your cart
- **Price Filtering**: Respects budget constraints in your requests
- **User-Friendly Interface**: Clean, modern popup interface

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The Smart Cart Assistant icon should appear in your toolbar

## Setup

1. Get an OpenAI API key from [OpenAI's website](https://platform.openai.com/api-keys)
2. Click the extension icon and enter your API key
3. Navigate to Amazon.com and ensure you're logged in
4. Start using the extension!

## Usage

1. Click the Smart Cart Assistant icon in your toolbar
2. Enter your product request in natural language, for example:
   - "Add a men's medium t-shirt under $25"
   - "Find a red wireless mouse under $50"
   - "Add Nike running shoes size 10 to my cart"
3. Click "Search & Add to Cart"
4. The extension will:
   - Parse your request with AI
   - Search for matching products on Amazon
   - Add the best matches to your cart

## Example Requests

- `Add a men's medium t-shirt under $25`
- `Find a wireless Bluetooth headphones under $100`
- `Add iPhone case red color to cart`
- `Get me a coffee mug with handle under $15`
- `Find Samsung phone charger fast charging`

## Requirements

- Google Chrome browser
- Valid OpenAI API key
- Amazon account (logged in)

## Privacy & Security

- Your OpenAI API key is stored locally on your device
- No personal data is sent to external servers except OpenAI for request parsing
- The extension only works on Amazon.com domains
- All searches and cart additions happen locally in your browser

## Limitations

- Only works on Amazon.com (US site)
- Requires valid OpenAI API key
- May not work with all product types or complex product variations
- Amazon's page structure changes may affect functionality

## Troubleshooting

### "Please navigate to Amazon.com first"
- Make sure you're on an Amazon.com page before using the extension

### "Add to Cart button not found"
- Some products may have complex selection requirements
- Try selecting product options manually first
- Product may be out of stock

### "Failed to parse request with AI"
- Check your OpenAI API key is valid
- Ensure you have API credits available
- Try simplifying your request

### Extension not working
- Refresh the Amazon page
- Check if you're logged into Amazon
- Disable other extensions that might interfere

## Development

The extension consists of:
- `manifest.json`: Extension configuration
- `popup.html/css/js`: User interface
- `content.js`: Amazon page interaction
- `background.js`: Background processes and API handling

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is provided as-is for educational purposes. Please respect Amazon's terms of service when using this extension.

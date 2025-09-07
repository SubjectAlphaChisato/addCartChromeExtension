// Content script for Amazon interaction
console.log('Smart Cart Assistant content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);

    if (request.action === 'searchProducts') {
        searchProducts(request.data)
            .then(products => sendResponse({ success: true, products }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'addToCart') {
        addProductsToCart(request.data.products)
            .then(results => sendResponse({ success: true, results }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }
});

// Search for products on Amazon
async function searchProducts(parsedRequest) {
    try {
        console.log('Searching for products with:', parsedRequest);

        // Build search query
        let searchQuery = parsedRequest.keywords || '';
        if (parsedRequest.category) searchQuery += ` ${parsedRequest.category}`;
        if (parsedRequest.size) searchQuery += ` ${parsedRequest.size}`;
        if (parsedRequest.color) searchQuery += ` ${parsedRequest.color}`;
        if (parsedRequest.brand) searchQuery += ` ${parsedRequest.brand}`;

        // Navigate to Amazon search
        const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`;
        
        // If we're not on a search page, navigate to search
        if (!window.location.href.includes('/s?k=')) {
            window.location.href = searchUrl;
            // Wait for page to load
            await new Promise(resolve => {
                const checkLoad = setInterval(() => {
                    if (document.readyState === 'complete') {
                        clearInterval(checkLoad);
                        resolve();
                    }
                }, 100);
            });
        }

        // Wait a bit for dynamic content to load
        await sleep(2000);

        // Extract product information from search results
        const products = extractProductsFromSearchPage(parsedRequest);
        
        console.log('Found products:', products);
        return products.slice(0, 5); // Return top 5 results

    } catch (error) {
        console.error('Error searching products:', error);
        throw error;
    }
}

// Extract products from Amazon search page
function extractProductsFromSearchPage(parsedRequest) {
    const products = [];
    
    // Amazon search result selectors (these may change)
    const productSelectors = [
        '[data-component-type="s-search-result"]',
        '.s-result-item',
        '[data-asin]:not([data-asin=""])'
    ];

    let productElements = [];
    
    // Try different selectors to find products
    for (const selector of productSelectors) {
        productElements = document.querySelectorAll(selector);
        if (productElements.length > 0) break;
    }

    console.log(`Found ${productElements.length} product elements`);

    productElements.forEach((element, index) => {
        try {
            // Skip if no ASIN (Amazon product ID)
            const asin = element.getAttribute('data-asin');
            if (!asin) return;

            // Extract product details
            const titleElement = element.querySelector('h2 a span, .s-size-mini span, [data-cy="title-recipe-title"]');
            const priceElement = element.querySelector('.a-price-whole, .a-price .a-offscreen');
            const linkElement = element.querySelector('h2 a, .s-link-style a');
            const imageElement = element.querySelector('img.s-image');

            if (!titleElement || !linkElement) return;

            const title = titleElement.textContent?.trim() || '';
            const priceText = priceElement?.textContent?.trim() || '';
            const link = linkElement.href;
            const image = imageElement?.src || '';

            // Parse price
            let price = null;
            const priceMatch = priceText.match(/[\d,]+\.?\d*/);
            if (priceMatch) {
                price = parseFloat(priceMatch[0].replace(',', ''));
            }

            // Filter by price if specified
            if (parsedRequest.maxPrice && price && price > parsedRequest.maxPrice) return;
            if (parsedRequest.minPrice && price && price < parsedRequest.minPrice) return;

            // Basic relevance scoring
            let relevanceScore = 0;
            const titleLower = title.toLowerCase();
            
            if (parsedRequest.keywords) {
                const keywords = parsedRequest.keywords.toLowerCase().split(' ');
                keywords.forEach(keyword => {
                    if (titleLower.includes(keyword)) relevanceScore += 10;
                });
            }
            
            if (parsedRequest.size && titleLower.includes(parsedRequest.size.toLowerCase())) {
                relevanceScore += 5;
            }
            
            if (parsedRequest.color && titleLower.includes(parsedRequest.color.toLowerCase())) {
                relevanceScore += 5;
            }
            
            if (parsedRequest.brand && titleLower.includes(parsedRequest.brand.toLowerCase())) {
                relevanceScore += 8;
            }

            products.push({
                asin,
                title,
                price: priceText,
                priceValue: price,
                link,
                image,
                relevanceScore,
                element
            });

        } catch (error) {
            console.error('Error extracting product info:', error);
        }
    });

    // Sort by relevance score
    products.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return products;
}

// Add products to cart
async function addProductsToCart(products) {
    const results = [];

    for (const product of products) {
        try {
            console.log('Adding to cart:', product.title);
            
            const result = await addSingleProductToCart(product);
            results.push({
                title: product.title,
                price: product.price,
                success: result.success,
                error: result.error
            });

            // Small delay between additions
            await sleep(1000);

        } catch (error) {
            console.error('Error adding product to cart:', error);
            results.push({
                title: product.title,
                price: product.price,
                success: false,
                error: error.message
            });
        }
    }

    return results;
}

// Add a single product to cart
async function addSingleProductToCart(product) {
    try {
        // Navigate to product page
        console.log('Navigating to product page:', product.link);
        
        // Open in same tab
        window.location.href = product.link;
        
        // Wait for page to load
        await waitForPageLoad();
        await sleep(2000);

        // Look for "Add to Cart" button
        const addToCartSelectors = [
            '#add-to-cart-button',
            '[name="submit.add-to-cart"]',
            '.a-button-input[aria-labelledby="attach-sidesheet-checkout-button-announce"]',
            '.a-button-input[value="Add to Cart"]'
        ];

        let addToCartButton = null;
        for (const selector of addToCartSelectors) {
            addToCartButton = document.querySelector(selector);
            if (addToCartButton && !addToCartButton.disabled) break;
        }

        if (!addToCartButton) {
            throw new Error('Add to Cart button not found');
        }

        if (addToCartButton.disabled) {
            throw new Error('Add to Cart button is disabled');
        }

        // Check if we need to select options first
        const sizeSelector = document.querySelector('#native_dropdown_selected_size_name, .a-dropdown-prompt');
        const colorSelector = document.querySelector('#native_dropdown_selected_color_name');

        // Try to select size if available and not selected
        if (sizeSelector && sizeSelector.textContent.includes('Select')) {
            const sizeOptions = document.querySelectorAll('[data-dp-url*="size_name"]');
            if (sizeOptions.length > 0) {
                // Try to find matching size or select first available
                let selectedSize = false;
                for (const option of sizeOptions) {
                    const sizeText = option.textContent.toLowerCase();
                    if (sizeText.includes('medium') || sizeText.includes('m ')) {
                        option.click();
                        selectedSize = true;
                        break;
                    }
                }
                if (!selectedSize && sizeOptions[0]) {
                    sizeOptions[0].click();
                }
                await sleep(1000);
            }
        }

        // Try to select color if available and not selected
        if (colorSelector && colorSelector.textContent.includes('Select')) {
            const colorOptions = document.querySelectorAll('[data-dp-url*="color_name"]');
            if (colorOptions.length > 0) {
                colorOptions[0].click();
                await sleep(1000);
            }
        }

        // Click Add to Cart
        console.log('Clicking Add to Cart button');
        addToCartButton.click();

        // Wait for response
        await sleep(2000);

        // Check if added successfully
        const successIndicators = [
            '.a-alert-success',
            '.sw-atc-added-to-cart',
            '[data-feature-name="addToCart"]'
        ];

        const hasSuccess = successIndicators.some(selector => 
            document.querySelector(selector)
        );

        // Check for error messages
        const errorSelectors = [
            '.a-alert-error',
            '.a-alert-warning'
        ];

        const errorElement = errorSelectors
            .map(selector => document.querySelector(selector))
            .find(el => el);

        if (errorElement) {
            throw new Error(errorElement.textContent.trim());
        }

        return {
            success: true,
            message: 'Added to cart successfully'
        };

    } catch (error) {
        console.error('Error adding single product to cart:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Utility functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForPageLoad() {
    return new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve, { once: true });
        }
    });
}

// Monitor for dynamic content changes
const observer = new MutationObserver((mutations) => {
    // Handle dynamic content if needed
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

console.log('Smart Cart Assistant content script initialized');

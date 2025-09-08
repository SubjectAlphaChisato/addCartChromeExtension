// Content script for Amazon interaction
console.log('Smart Cart Assistant content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);

    // Handle ping to check if content script is ready
    if (request.action === 'ping') {
        sendResponse({ success: true, message: 'Content script ready' });
        return;
    }

    if (request.action === 'searchProducts') {
        searchProducts(request.data)
            .then(products => sendResponse({ success: true, products }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'addToCart') {
        addProductsToCart(request.data.products)
            .then(results => {
                // Check if we can still send response (connection might be lost due to navigation)
                try {
                    sendResponse({ success: true, results });
                } catch (error) {
                    console.log('Cannot send response - connection lost due to navigation:', error.message);
                    // Store results in local storage for popup to retrieve
                    chrome.storage.local.set({
                        lastAddToCartResults: {
                            results: results,
                            timestamp: Date.now()
                        }
                    });
                }
            })
            .catch(error => {
                try {
                    sendResponse({ success: false, error: error.message });
                } catch (responseError) {
                    console.log('Cannot send error response - connection lost:', responseError.message);
                    // Store error in local storage
                    chrome.storage.local.set({
                        lastAddToCartResults: {
                            error: error.message,
                            timestamp: Date.now()
                        }
                    });
                }
            });
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
        console.log('Products array length:', products.length);
        
        if (products.length === 0) {
            console.warn('No products extracted from page. URL:', window.location.href);
            console.warn('Page HTML preview:', document.body.innerHTML.substring(0, 500));
        }
        
        return products.slice(0, 5); // Return top 5 results

    } catch (error) {
        console.error('Error searching products:', error);
        throw error;
    }
}

// Extract products from Amazon search page
function extractProductsFromSearchPage(parsedRequest) {
    const products = [];
    
    // Amazon search result selectors (updated for current Amazon layout)
    const productSelectors = [
        '[data-component-type="s-search-result"]',
        '.s-result-item',
        '[data-asin]:not([data-asin=""])',
        '.s-card-container',
        '.s-expand-height',
        '.AdHolder',
        '[cel_widget_id*="MAIN-SEARCH_RESULTS"]'
    ];

    let productElements = [];
    
    // Try different selectors to find products
    for (const selector of productSelectors) {
        productElements = document.querySelectorAll(selector);
        console.log(`Trying selector "${selector}": found ${productElements.length} elements`);
        if (productElements.length > 0) break;
    }

    console.log(`Found ${productElements.length} product elements using best selector`);
    
    // If no products found with standard selectors, try a more general approach
    if (productElements.length === 0) {
        console.log('No products found with standard selectors, trying generic approach...');
        // Look for any elements with data-asin attribute
        productElements = document.querySelectorAll('[data-asin]');
        console.log(`Generic search found ${productElements.length} elements with data-asin`);
    }

    productElements.forEach((element, index) => {
        try {
            // Skip if no ASIN (Amazon product ID)
            const asin = element.getAttribute('data-asin');
            if (!asin) return;

            // Extract product details with multiple selector fallbacks
            const titleSelectors = [
                'h2 a span',
                '.s-size-mini span', 
                '[data-cy="title-recipe-title"]',
                'h2 span',
                '.a-size-base-plus',
                '.a-size-medium',
                '.s-link-style .a-text-normal'
            ];
            
            const priceSelectors = [
                '.a-price-whole',
                '.a-price .a-offscreen',
                '.a-price-range',
                '.a-price',
                '.s-price-instructions-style .a-offscreen'
            ];
            
            const linkSelectors = [
                'h2 a',
                '.s-link-style a',
                'a[href*="/dp/"]',
                'a[href*="/gp/product/"]'
            ];
            
            let titleElement = null;
            for (const selector of titleSelectors) {
                titleElement = element.querySelector(selector);
                if (titleElement && titleElement.textContent.trim()) break;
            }
            
            let priceElement = null;
            for (const selector of priceSelectors) {
                priceElement = element.querySelector(selector);
                if (priceElement && priceElement.textContent.trim()) break;
            }
            
            let linkElement = null;
            for (const selector of linkSelectors) {
                linkElement = element.querySelector(selector);
                if (linkElement && linkElement.href) break;
            }
            
            const imageElement = element.querySelector('img.s-image, img[data-image-latency], .s-image img');

            console.log(`Product ${index + 1}: Title found: ${!!titleElement}, Link found: ${!!linkElement}, Price found: ${!!priceElement}`);
            
            if (!titleElement || !linkElement) {
                console.log(`Skipping product ${index + 1}: missing title or link`);
                return;
            }

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

            const product = {
                asin,
                title,
                price: priceText,
                priceValue: price,
                link,
                image,
                relevanceScore,
                element
            };
            
            console.log(`Adding product ${index + 1}:`, {
                title: product.title,
                price: product.price,
                relevanceScore: product.relevanceScore,
                asin: product.asin
            });
            
            products.push(product);

        } catch (error) {
            console.error('Error extracting product info:', error);
        }
    });

    // If no products found, try a simple fallback approach
    if (products.length === 0) {
        console.log('No products found with detailed extraction, trying simple fallback...');
        const fallbackProducts = tryFallbackExtraction(parsedRequest);
        if (fallbackProducts.length > 0) {
            console.log('Fallback extraction found products:', fallbackProducts.length);
            return fallbackProducts;
        }
    }

    // Sort by relevance score
    products.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    console.log('Final products before returning:', products.map(p => ({ title: p.title, asin: p.asin })));

    return products;
}

// Fallback extraction method for when main selectors fail
function tryFallbackExtraction(parsedRequest) {
    const products = [];
    
    try {
        // Look for any links that might be product links
        const productLinks = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]');
        console.log(`Fallback: Found ${productLinks.length} potential product links`);
        
        productLinks.forEach((link, index) => {
            if (index >= 10) return; // Limit to first 10
            
            try {
                const href = link.href;
                const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})/);
                if (!asinMatch) return;
                
                const asin = asinMatch[1] || asinMatch[2];
                const title = link.textContent?.trim() || link.getAttribute('title') || `Product ${asin}`;
                
                if (title.length < 5) return; // Skip very short titles
                
                products.push({
                    asin,
                    title,
                    price: 'Price not available',
                    priceValue: null,
                    link: href,
                    image: '',
                    relevanceScore: 1, // Low score for fallback
                    element: link
                });
                
                console.log(`Fallback product ${index + 1}:`, { title, asin });
                
            } catch (error) {
                console.error('Error in fallback extraction:', error);
            }
        });
    } catch (error) {
        console.error('Fallback extraction failed:', error);
    }

    return products;
}

// Try to add product to cart directly from search results page
async function tryAddToCartFromSearchResults(product) {
    try {
        console.log('Looking for Add to Cart button in search results for:', product.asin);
        
        // Find the product element on the search results page
        let productElement = product.element;
        
        // If we don't have the element, try to find it by ASIN
        if (!productElement) {
            productElement = document.querySelector(`[data-asin="${product.asin}"]`);
        }
        
        if (!productElement) {
            console.log('Product element not found on search page');
            return false;
        }
        
        // Look for Add to Cart button within the product element or nearby
        const addToCartSelectors = [
            // Direct add to cart buttons in search results
            '.s-add-to-cart-button',
            '[data-action="add-to-cart"]',
            'button[data-action*="cart"]',
            '.a-button[data-action="add-to-cart"]',
            // Quick add buttons
            'input[value*="Add to Cart"]',
            'input[value*="Add to cart"]',
            'button[aria-label*="Add to Cart"]',
            'button[aria-label*="Add to cart"]',
            // Amazon's newer quick add features
            '[data-cy="add-to-cart"]',
            '.puis-add-to-cart-button',
            '.s-atc-button',
            '.a-button-base',
            // Generic cart buttons
            'input[type="submit"][value*="Cart"]',
            'input[type="submit"][value*="cart"]',
            'button[title*="Add to Cart"]',
            'button[title*="Add to cart"]',
            // More generic approaches
            'button[data-testid*="cart"]',
            'button[class*="cart"]',
            '[role="button"][aria-label*="cart"]',
            // Form-based add to cart
            'form[action*="cart"] input[type="submit"]',
            'form[action*="cart"] button',
            // Specific Amazon patterns
            '.a-button-input[value*="cart"]',
            '.a-button-input[value*="Cart"]'
        ];
        
        let addToCartButton = null;
        
        // First, look within the specific product element
        for (const selector of addToCartSelectors) {
            addToCartButton = productElement.querySelector(selector);
            if (addToCartButton && !addToCartButton.disabled) {
                console.log(`Found Add to Cart button with selector: ${selector}`);
                break;
            }
        }
        
        // If not found within product element, look in the entire document
        if (!addToCartButton) {
            for (const selector of addToCartSelectors) {
                const buttons = document.querySelectorAll(selector);
                for (const button of buttons) {
                    // Check if this button is related to our product
                    const buttonParent = button.closest('[data-asin]');
                    if (buttonParent && buttonParent.getAttribute('data-asin') === product.asin) {
                        addToCartButton = button;
                        console.log(`Found Add to Cart button for ASIN ${product.asin} with selector: ${selector}`);
                        break;
                    }
                }
                if (addToCartButton) break;
            }
        }
        
        // Alternative approach: look for buttons with "Add to Cart" text
        if (!addToCartButton) {
            const allButtons = productElement.querySelectorAll('button, input[type="submit"], .a-button');
            for (const button of allButtons) {
                const buttonText = button.textContent || button.value || button.getAttribute('aria-label') || '';
                if (buttonText.toLowerCase().includes('add to cart') || 
                    buttonText.toLowerCase().includes('add to basket')) {
                    addToCartButton = button;
                    console.log('Found Add to Cart button by text content');
                    break;
                }
            }
        }
        
        if (!addToCartButton) {
            console.log('No Add to Cart button found on search results page');
            
            // Debug: Show what buttons are actually available
            const allButtons = productElement.querySelectorAll('button, input[type="submit"], .a-button');
            console.log(`Debug: Found ${allButtons.length} total buttons in product element`);
            allButtons.forEach((btn, idx) => {
                const text = btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || 'No text';
                const classes = btn.className || 'No classes';
                console.log(`Button ${idx + 1}: "${text}" | Classes: "${classes}"`);
            });
            
            // Also check what's available on the entire page
            const pageButtons = document.querySelectorAll('button, input[type="submit"]');
            const cartRelatedButtons = Array.from(pageButtons).filter(btn => {
                const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase();
                return text.includes('cart') || text.includes('add');
            });
            console.log(`Debug: Found ${cartRelatedButtons.length} cart/add-related buttons on entire page`);
            cartRelatedButtons.forEach((btn, idx) => {
                const text = btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || 'No text';
                console.log(`Page cart button ${idx + 1}: "${text}"`);
            });
            
            return false;
        }
        
        if (addToCartButton.disabled) {
            console.log('Add to Cart button is disabled');
            return false;
        }
        
        console.log('Clicking Add to Cart button from search results');
        
        // Highlight the button for debugging (optional visual feedback)
        const originalStyle = addToCartButton.style.cssText;
        addToCartButton.style.border = '3px solid red';
        addToCartButton.style.backgroundColor = 'yellow';
        
        // Scroll button into view
        addToCartButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1000);
        
        // Click the button
        addToCartButton.click();
        
        // Restore original style after a moment
        setTimeout(() => {
            addToCartButton.style.cssText = originalStyle;
        }, 3000);
        
        // Wait for response
        await sleep(2000);
        
        // Check for success indicators
        const successIndicators = [
            '.a-alert-success',
            '.sw-atc-added-to-cart',
            '[data-feature-name="addToCart"]',
            '.s-cart-added-confirmation',
            '.a-changeover-inner'
        ];
        
        for (const selector of successIndicators) {
            if (document.querySelector(selector)) {
                console.log('Success: Product added to cart from search results');
                return true;
            }
        }
        
        // Check if cart icon updated (count increased)
        const cartCountElement = document.querySelector('#nav-cart-count, .nav-cart-count');
        if (cartCountElement) {
            console.log('Cart count element found, assuming success');
            return true;
        }
        
        console.log('No clear success indicator found');
        return false;
        
    } catch (error) {
        console.error('Error adding to cart from search results:', error);
        return false;
    }
}

// Add to cart from Product Detail Page (PDP)
async function addToCartFromPDP(product) {
    try {
        console.log('=== Navigating to PDP for:', product.title);
        console.log('Product URL:', product.link);
        
        // Navigate to product page
        window.location.href = product.link;
        
        // Wait for page to load completely
        await waitForPageLoad();
        await sleep(3000); // Give extra time for dynamic content
        
        console.log('PDP loaded, looking for Add to Cart button...');
        
        // Look for Add to Cart button using the exact structure from your provided HTML
        const pdpAddToCartSelectors = [
            // Exact button based on your HTML structure (highest priority)
            'input#add-to-cart-button[name="submit.add-to-cart"][value="Add to Cart"]',
            'input[id="add-to-cart-button"][name="submit.add-to-cart"]',
            'input[name="submit.add-to-cart"][title="Add to Shopping Cart"]',
            'input[formaction*="/cart/add-to-cart"][class*="a-button-input"]',
            'input[aria-labelledby="submit.add-to-cart-announce"]',
            
            // Primary selectors based on your HTML
            '#add-to-cart-button',                    // Main button ID
            'input[name="submit.add-to-cart"]',       // Input element name
            'input[value="Add to Cart"]',             // Input by value
            'input[title*="Add to Shopping Cart"]',   // Input by title
            'input[formaction*="/cart/add-to-cart"]', // By form action
            'input.a-button-input[type="submit"]',    // Class and type match
            
            // Secondary selectors within containers
            '#addToCart_feature_div input[type="submit"]', // Within the feature div
            '.a-button-primary input[type="submit"]',       // Primary button input
            'span[id*="submit.add-to-cart"] input',        // Input within submit span
            
            // Fallback selectors
            'button[data-action="add-to-cart"]',     // Button with data action
            '.a-button-primary',                     // Primary button container
            '#dp-buy-box input[type="submit"]',      // Buy box submit button
            '[data-feature-name="addToCart"] input[type="submit"]' // Feature-based selector
        ];
        
        let addToCartButton = null;
        
        // Try each selector with validation
        for (const selector of pdpAddToCartSelectors) {
            try {
                const candidate = document.querySelector(selector);
                if (candidate && !candidate.disabled && 
                    candidate.style.display !== 'none' &&
                    !candidate.style.visibility === 'hidden') {
                    
                    // Additional validation for the exact button structure
                    const isCorrectButton = (
                        candidate.id === 'add-to-cart-button' ||
                        candidate.name === 'submit.add-to-cart' ||
                        candidate.value === 'Add to Cart' ||
                        candidate.title?.includes('Add to Shopping Cart') ||
                        candidate.getAttribute('formaction')?.includes('/cart/add-to-cart')
                    );
                    
                    if (isCorrectButton) {
                        addToCartButton = candidate;
                        console.log(`✅ Found validated PDP Add to Cart button with selector: ${selector}`);
                        console.log(`Button details: ID="${candidate.id}" Name="${candidate.name}" Value="${candidate.value}"`);
                        break;
                    } else {
                        console.log(`Found element with selector ${selector} but validation failed`);
                    }
                }
            } catch (e) {
                console.log(`Selector failed: ${selector}`, e.message);
            }
        }
        
        if (!addToCartButton) {
            console.log('No Add to Cart button found on PDP');
            
            // Debug: Show what's available on PDP with full details
            const allInputs = document.querySelectorAll('input[type="submit"], button');
            console.log(`Debug: Found ${allInputs.length} submit inputs/buttons on PDP`);
            allInputs.forEach((input, idx) => {
                const details = {
                    value: input.value || 'No value',
                    id: input.id || 'No ID',
                    name: input.name || 'No name',
                    title: input.title || 'No title',
                    className: input.className || 'No classes',
                    formaction: input.getAttribute('formaction') || 'No formaction',
                    ariaLabel: input.getAttribute('aria-labelledby') || 'No aria-labelledby',
                    text: input.textContent?.trim() || 'No text'
                };
                console.log(`PDP Button ${idx + 1}:`, details);
            });
            
            // Also check for the exact button structure you provided
            const exactButton = document.querySelector('input[id="add-to-cart-button"][name="submit.add-to-cart"]');
            if (exactButton) {
                console.log('🎯 Found exact button structure but it failed validation. Details:', {
                    disabled: exactButton.disabled,
                    display: exactButton.style.display,
                    visibility: exactButton.style.visibility,
                    offsetParent: exactButton.offsetParent // null if hidden
                });
            } else {
                console.log('❌ Exact button structure not found on page');
            }
            
            // Last resort: try to find any button with "Add to Cart" characteristics
            const lastResortButton = document.querySelector('#add-to-cart-button') || 
                                   document.querySelector('input[name="submit.add-to-cart"]') ||
                                   document.querySelector('input[value="Add to Cart"]');
            
            if (lastResortButton) {
                console.log('🚨 Found last resort button, attempting to use it...');
                addToCartButton = lastResortButton;
            } else {
                return {
                    success: false,
                    error: 'Add to Cart button not found on product page'
                };
            }
        }
        
        if (addToCartButton.disabled) {
            console.log('Add to Cart button is disabled on PDP');
            return {
                success: false,
                error: 'Product is currently unavailable (button disabled)'
            };
        }
        
        console.log('Clicking Add to Cart button on PDP...');
        
        // Highlight the button for debugging
        const originalStyle = addToCartButton.style.cssText;
        addToCartButton.style.border = '3px solid green';
        addToCartButton.style.backgroundColor = 'lightgreen';
        
        // Scroll to button and click
        addToCartButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1000);
        
        // Handle any required selections first (size, color, etc.)
        await handleProductOptions();
        
        // Click the Add to Cart button
        addToCartButton.click();
        
        // Restore original style
        setTimeout(() => {
            if (addToCartButton.style) {
                addToCartButton.style.cssText = originalStyle;
            }
        }, 3000);
        
        // Wait for response
        await sleep(3000);
        
        // Check for success indicators on PDP
        const pdpSuccessSelectors = [
            '.a-alert-success',
            '#sw-atc-added-to-cart',
            '#attachDisplayAddBaseAlert',
            '.a-changeover-inner',
            '[data-feature-name="addToCart"] .a-alert-success',
            '#huc-v2-order-row-confirm-text', // Amazon's confirmation text
            '.a-alert[data-a-subst="-aui-template-confirm-cart-add-html"]'
        ];
        
        let success = false;
        for (const selector of pdpSuccessSelectors) {
            if (document.querySelector(selector)) {
                console.log(`Success detected with selector: ${selector}`);
                success = true;
                break;
            }
        }
        
        // Check for error messages
        const pdpErrorSelectors = [
            '.a-alert-error',
            '.a-alert-warning',
            '#outOfStock',
            '#availability .a-color-state',
            '.a-alert[data-a-subst="-aui-template-error-cart-add-html"]'
        ];
        
        for (const selector of pdpErrorSelectors) {
            const errorElement = document.querySelector(selector);
            if (errorElement && errorElement.textContent.trim()) {
                const errorText = errorElement.textContent.trim();
                console.log(`Error detected: ${errorText}`);
                return {
                    success: false,
                    error: errorText
                };
            }
        }
        
        // Check if cart count increased (alternative success check)
        const cartCountElement = document.querySelector('#nav-cart-count, .nav-cart-count');
        if (cartCountElement) {
            console.log('Cart count element found, assuming success');
            success = true;
        }
        
        const result = success ? {
            success: true,
            message: 'Added to cart from product page'
        } : {
            success: false,
            error: 'Uncertain if product was added - please check your cart'
        };
        
        // Store result in local storage in case message channel is broken
        chrome.storage.local.set({
            lastAddToCartResults: {
                results: [result],
                timestamp: Date.now()
            }
        });
        
        if (success) {
            console.log('SUCCESS: Product added to cart from PDP');
        } else {
            console.log('No clear success/error indicator found on PDP');
        }
        
        return result;
        
    } catch (error) {
        console.error('Error adding to cart from PDP:', error);
        
        const errorResult = {
            success: false,
            error: `PDP Error: ${error.message}`
        };
        
        // Store error result in local storage
        chrome.storage.local.set({
            lastAddToCartResults: {
                results: [errorResult],
                timestamp: Date.now()
            }
        });
        
        return errorResult;
    }
}

// Handle product options (size, color, etc.) on PDP
async function handleProductOptions() {
    try {
        console.log('Checking for product options to select...');
        
        // Look for size selection
        const sizeSelectors = [
            '#native_dropdown_selected_size_name',
            '.a-dropdown-prompt',
            'select[name*="size"]',
            '[data-action="main-image-click"] select'
        ];
        
        for (const selector of sizeSelectors) {
            const sizeElement = document.querySelector(selector);
            if (sizeElement && sizeElement.textContent && sizeElement.textContent.includes('Select')) {
                console.log('Size selection required, attempting to select...');
                
                // Try to find size options
                const sizeOptions = document.querySelectorAll('[data-dp-url*="size_name"], .a-dropdown-container li');
                if (sizeOptions.length > 0) {
                    // Try to select a medium size or first available
                    let selectedSize = false;
                    for (const option of sizeOptions) {
                        const optionText = option.textContent.toLowerCase();
                        if (optionText.includes('medium') || optionText.includes('m ')) {
                            option.click();
                            selectedSize = true;
                            console.log('Selected medium size');
                            break;
                        }
                    }
                    if (!selectedSize && sizeOptions[0]) {
                        sizeOptions[0].click();
                        console.log('Selected first available size');
                    }
                    await sleep(1000);
                }
                break;
            }
        }
        
        // Look for color selection
        const colorSelectors = [
            '#native_dropdown_selected_color_name',
            'select[name*="color"]'
        ];
        
        for (const selector of colorSelectors) {
            const colorElement = document.querySelector(selector);
            if (colorElement && colorElement.textContent && colorElement.textContent.includes('Select')) {
                console.log('Color selection required, attempting to select...');
                
                const colorOptions = document.querySelectorAll('[data-dp-url*="color_name"]');
                if (colorOptions.length > 0) {
                    colorOptions[0].click();
                    console.log('Selected first available color');
                    await sleep(1000);
                }
                break;
            }
        }
        
    } catch (error) {
        console.error('Error handling product options:', error);
        // Continue anyway - options might not be required
    }
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
        console.log('=== Starting addSingleProductToCart for:', product.title);
        console.log('Current URL before add attempt:', window.location.href);
        
        // First, try to add to cart directly from search results page
        const searchPageSuccess = await tryAddToCartFromSearchResults(product);
        if (searchPageSuccess) {
            console.log('SUCCESS: Added to cart from search results');
            return { success: true, message: 'Added to cart from search results' };
        }
        
        console.log('Search results add failed, trying product detail page...');
        console.log('Current URL after search results attempt:', window.location.href);
        
        // Fallback: Navigate to product detail page and add to cart
        return await addToCartFromPDP(product);

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

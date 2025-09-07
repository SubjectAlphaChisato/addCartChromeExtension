// DOM elements
const productRequestInput = document.getElementById('productRequest');
const apiKeyInput = document.getElementById('apiKey');
const searchBtn = document.getElementById('searchBtn');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const btnText = document.querySelector('.btn-text');
const loadingText = document.querySelector('.loading');

// Load saved API key
chrome.storage.local.get(['openaiApiKey'], (result) => {
    if (result.openaiApiKey) {
        apiKeyInput.value = result.openaiApiKey;
    }
});

// Save API key when changed
apiKeyInput.addEventListener('change', () => {
    chrome.storage.local.set({ 
        openaiApiKey: apiKeyInput.value 
    });
});

// Main search and add to cart function
searchBtn.addEventListener('click', async () => {
    const productRequest = productRequestInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    if (!productRequest) {
        showStatus('Please enter a product request', 'error');
        return;
    }

    if (!apiKey) {
        showStatus('Please enter your OpenAI API key', 'error');
        return;
    }

    // Save API key
    chrome.storage.local.set({ openaiApiKey: apiKey });

    // Check if user is on Amazon
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('amazon.com')) {
        showStatus('Please navigate to Amazon.com first', 'error');
        return;
    }

    // Disable button and show loading
    setLoadingState(true);
    clearResults();
    showStatus('Processing your request with AI...', 'info');

    try {
        // Step 1: Parse the request with GPT-3.5
        showStatus('🤖 Analyzing your request...', 'info');
        const parsedRequest = await parseProductRequest(productRequest, apiKey);
        
        if (!parsedRequest) {
            throw new Error('Failed to parse product request');
        }

        showStatus('🔍 Searching for products on Amazon...', 'info');

        // Step 2: Search for products on Amazon
        const searchResults = await searchProductsOnAmazon(parsedRequest, tab.id);
        
        if (searchResults.length === 0) {
            showStatus('No products found matching your criteria. Try a different search.', 'error');
            return;
        }

        // Step 3: Add products to cart
        showStatus('🛒 Adding products to cart...', 'info');
        const addToCartResults = await addProductsToCart(searchResults, tab.id);

        // Show results
        displayResults(addToCartResults);
        
        if (addToCartResults.some(result => result.success)) {
            showStatus('✅ Successfully added products to cart!', 'success');
        } else {
            showStatus('❌ Failed to add products to cart. Please try again.', 'error');
        }

    } catch (error) {
        console.error('Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        setLoadingState(false);
    }
});

// Parse product request using GPT-3.5
async function parseProductRequest(request, apiKey) {
    const prompt = `Parse this product request and extract structured information. Return a JSON object with the following fields:
- keywords: main search terms
- category: product category (optional)
- size: size requirement (optional)
- color: color preference (optional)
- maxPrice: maximum price in USD (optional, extract number only)
- minPrice: minimum price in USD (optional, extract number only)
- brand: preferred brand (optional)
- quantity: how many items (default 1)

Request: "${request}"

Return only valid JSON, no additional text.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'user', content: prompt }
                ],
                max_tokens: 200,
                temperature: 0.3
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'OpenAI API error');
        }

        const parsedResponse = JSON.parse(data.choices[0].message.content);
        console.log('Parsed request:', parsedResponse);
        return parsedResponse;
        
    } catch (error) {
        console.error('Error parsing request:', error);
        throw new Error('Failed to parse request with AI');
    }
}

// Search for products on Amazon
async function searchProductsOnAmazon(parsedRequest, tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
            action: 'searchProducts',
            data: parsedRequest
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
                resolve(response.products || []);
            } else {
                reject(new Error(response?.error || 'Failed to search products'));
            }
        });
    });
}

// Add products to cart
async function addProductsToCart(products, tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
            action: 'addToCart',
            data: { products }
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response) {
                resolve(response.results || []);
            } else {
                reject(new Error('Failed to add products to cart'));
            }
        });
    });
}

// UI Helper functions
function setLoadingState(loading) {
    searchBtn.disabled = loading;
    if (loading) {
        btnText.style.display = 'none';
        loadingText.style.display = 'inline';
    } else {
        btnText.style.display = 'inline';
        loadingText.style.display = 'none';
    }
}

function showStatus(message, type) {
    statusDiv.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
}

function clearResults() {
    resultsDiv.innerHTML = '';
}

function displayResults(results) {
    resultsDiv.innerHTML = '';
    
    results.forEach((result, index) => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'product-result';
        
        resultDiv.innerHTML = `
            <div class="product-title">${result.title || `Product ${index + 1}`}</div>
            <div class="product-price">${result.price || 'Price not available'}</div>
            <div class="product-status">${result.success ? '✅ Added to cart' : '❌ Failed to add'}</div>
        `;
        
        resultsDiv.appendChild(resultDiv);
    });
}

// Handle Enter key in textarea
productRequestInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
        searchBtn.click();
    }
});

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
        
        console.log('Search results received in popup:', searchResults);
        console.log('Search results length:', searchResults ? searchResults.length : 'undefined');
        
        if (!searchResults || searchResults.length === 0) {
            console.warn('No search results returned. Parsed request was:', parsedRequest);
            showStatus('No products found matching your criteria. Try a different search.', 'error');
            return;
        }

        // Step 3: Add products to cart
        showStatus('🛒 Adding products to cart...', 'info');
        const addToCartResults = await addProductsToCart(searchResults, tab.id);

        // Show results
        displayResults(addToCartResults);
        
        const successCount = addToCartResults.filter(result => result.success).length;
        const totalCount = addToCartResults.length;
        
        if (successCount === totalCount) {
            showStatus('✅ Successfully added all products to cart!', 'success');
        } else if (successCount > 0) {
            showStatus(`⚠️ Added ${successCount} of ${totalCount} products. Please add remaining items manually.`, 'warning');
        } else {
            // Check if any products attempted PDP navigation
            const pdpAttempts = addToCartResults.filter(result => 
                result.error && result.error.includes('Connection lost')
            );
            
            if (pdpAttempts.length > 0) {
                showStatus('🔄 Extension navigated to product pages to add items. Check your cart for results!', 'info');
            } else {
                showStatus('💡 Found products but couldn\'t add automatically. Please click "Add to Cart" buttons manually.', 'info');
            }
        }

    } catch (error) {
        console.error('Error:', error);
        
        // Provide user-friendly error messages
        let userMessage = error.message;
        if (error.message.includes('back/forward cache') || error.message.includes('message channel is closed')) {
            userMessage = 'Connection lost with Amazon page. Please refresh the page and try again.';
        } else if (error.message.includes('Failed to initialize extension')) {
            userMessage = 'Extension failed to load properly. Please refresh the Amazon page and try again.';
        } else if (error.message.includes('OpenAI API')) {
            userMessage = 'AI service error. Please check your API key and try again.';
        } else if (error.message.includes('No products found')) {
            userMessage = 'No matching products found. Try using different search terms.';
        }
        
        showStatus(`❌ ${userMessage}`, 'error');
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
    return new Promise(async (resolve, reject) => {
        try {
            // First, ensure content script is injected and ready
            await ensureContentScriptReady(tabId);
            
            chrome.tabs.sendMessage(tabId, {
                action: 'searchProducts',
                data: parsedRequest
            }, (response) => {
                if (chrome.runtime.lastError) {
                    const errorMessage = chrome.runtime.lastError.message;
                    
                    // Handle specific bfcache error
                    if (errorMessage.includes('back/forward cache') || 
                        errorMessage.includes('message channel is closed') ||
                        errorMessage.includes('receiving end does not exist')) {
                        
                        console.log('Content script disconnected, attempting to reinject...');
                        // Try to reinject content script and retry
                        reinjectContentScriptAndRetry(tabId, parsedRequest, 'searchProducts')
                            .then(resolve)
                            .catch(reject);
                    } else {
                        reject(new Error(`Communication error: ${errorMessage}`));
                    }
                } else if (response && response.success) {
                    resolve(response.products || []);
                } else {
                    reject(new Error(response?.error || 'Failed to search products'));
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Add products to cart
async function addProductsToCart(products, tabId) {
    return new Promise(async (resolve, reject) => {
        try {
            // First, ensure content script is injected and ready
            await ensureContentScriptReady(tabId);
            
            chrome.tabs.sendMessage(tabId, {
                action: 'addToCart',
                data: { products }
            }, async (response) => {
                if (chrome.runtime.lastError) {
                    const errorMessage = chrome.runtime.lastError.message;
                    
                    // Handle message channel closure (common with PDP navigation)
                    if (errorMessage.includes('message channel closed') || 
                        errorMessage.includes('asynchronous response') ||
                        errorMessage.includes('back/forward cache') || 
                        errorMessage.includes('receiving end does not exist')) {
                        
                        console.log('Message channel closed - checking storage for results...');
                        
                        // Wait a moment for content script to store results
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // Try to retrieve results from storage
                        const storedResults = await checkStorageForResults();
                        if (storedResults) {
                            resolve(storedResults);
                        } else {
                            // If no stored results, try to reinject and retry
                            console.log('No stored results found, attempting to reinject...');
                            reinjectContentScriptAndRetry(tabId, { products }, 'addToCart')
                                .then(resolve)
                                .catch(reject);
                        }
                    } else {
                        reject(new Error(`Communication error: ${errorMessage}`));
                    }
                } else if (response) {
                    resolve(response.results || []);
                } else {
                    reject(new Error('Failed to add products to cart'));
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Check storage for results when message channel is closed
async function checkStorageForResults() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastAddToCartResults'], (result) => {
            const storedData = result.lastAddToCartResults;
            
            if (storedData) {
                // Check if results are recent (within last 10 seconds)
                const isRecent = (Date.now() - storedData.timestamp) < 10000;
                
                if (isRecent) {
                    console.log('Found recent stored results:', storedData);
                    
                    // Clear the stored results after retrieving
                    chrome.storage.local.remove(['lastAddToCartResults']);
                    
                    if (storedData.results) {
                        resolve(storedData.results);
                    } else if (storedData.error) {
                        // Convert stored error back to rejected promise
                        resolve([{
                            success: false,
                            error: storedData.error,
                            title: 'Navigation Error'
                        }]);
                    } else {
                        resolve(null);
                    }
                } else {
                    console.log('Stored results are too old, ignoring');
                    resolve(null);
                }
            } else {
                console.log('No stored results found');
                resolve(null);
            }
        });
    });
}

// Content script management functions
async function ensureContentScriptReady(tabId) {
    return new Promise((resolve, reject) => {
        // Try to ping the content script
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                // Content script not ready, try to inject it
                console.log('Content script not ready, injecting...');
                injectContentScript(tabId)
                    .then(resolve)
                    .catch(reject);
            } else {
                resolve();
            }
        });
    });
}

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        
        // Wait a moment for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('Content script injected successfully');
    } catch (error) {
        console.error('Failed to inject content script:', error);
        throw new Error('Failed to initialize extension on this page. Please refresh the page and try again.');
    }
}

async function reinjectContentScriptAndRetry(tabId, data, action) {
    try {
        // Inject content script
        await injectContentScript(tabId);
        
        // Retry the original message
        return new Promise((resolve, reject) => {
            const messageData = action === 'searchProducts' 
                ? { action: 'searchProducts', data }
                : { action: 'addToCart', data };
            
            chrome.tabs.sendMessage(tabId, messageData, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Retry failed: ${chrome.runtime.lastError.message}`));
                } else if (response && response.success) {
                    if (action === 'searchProducts') {
                        resolve(response.products || []);
                    } else {
                        resolve(response.results || []);
                    }
                } else {
                    reject(new Error(response?.error || `Failed to ${action} after retry`));
                }
            });
        });
    } catch (error) {
        throw new Error(`Failed to recover from connection error: ${error.message}`);
    }
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

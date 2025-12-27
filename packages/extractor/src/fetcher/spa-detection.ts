// SPA and JavaScript-heavy page detection utilities

/**
 * Detect if a page requires JavaScript to render meaningful content
 */
export function isJavaScriptRequired(html: string): boolean {
  // Check for SPA framework indicators
  const spaIndicators = [
    /<div id="root"><\/div>/i, // React
    /<div id="app"><\/div>/i, // Vue
    /ng-app/i, // Angular
    /<script.*type="module"/i, // ES modules
    /window\.__INITIAL_STATE__/i, // SSR hydration
    /__NEXT_DATA__/i, // Next.js
    /__NUXT__/i, // Nuxt.js
    /GATSBY_/i, // Gatsby
  ];

  // Check if any SPA indicator is present
  for (const pattern of spaIndicators) {
    if (pattern.test(html)) return true;
  }

  // Extract body content without scripts
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    const bodyContent = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();

    // Count visible text content
    const textContent = bodyContent
      .replace(/<[^>]+>/g, ' ') // Remove tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // If body has very little text but many scripts, it's likely SPA
    if (textContent.length < 500) {
      const scriptCount = (html.match(/<script/gi) || []).length;
      if (scriptCount > 3) return true;
    }

    // Check for loading/skeleton indicators
    const loadingIndicators = [
      /loading/i,
      /skeleton/i,
      /spinner/i,
      /please wait/i,
      /initializing/i,
    ];

    if (bodyContent.length < 1000) {
      for (const pattern of loadingIndicators) {
        if (pattern.test(bodyContent)) return true;
      }
    }
  }

  return false;
}

/**
 * Analyze HTML to determine if it's meaningful content or just a shell
 */
export function analyzeContentQuality(html: string): {
  hasContent: boolean;
  textLength: number;
  scriptCount: number;
  isLikelySPA: boolean;
  confidence: number;
} {
  const scriptCount = (html.match(/<script/gi) || []).length;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);

  let textLength = 0;
  let hasContent = false;
  let isLikelySPA = false;
  let confidence = 0;

  if (bodyMatch && bodyMatch[1]) {
    const bodyWithoutScripts = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const textContent = bodyWithoutScripts
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    textLength = textContent.length;
    hasContent = textLength > 200;
  }

  // Determine if it's likely an SPA
  if (isJavaScriptRequired(html)) {
    isLikelySPA = true;
    confidence = 0.8;
  }

  // Low text with many scripts = high SPA confidence
  if (textLength < 500 && scriptCount > 5) {
    isLikelySPA = true;
    confidence = 0.9;
  }

  // Reasonable text content = not SPA
  if (textLength > 2000) {
    isLikelySPA = false;
    confidence = 0.7;
  }

  return {
    hasContent,
    textLength,
    scriptCount,
    isLikelySPA,
    confidence,
  };
}

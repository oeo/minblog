import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { marked } from 'marked';
import { Feed } from 'feed';
import express from 'express';
import compression from 'compression';
import dotenv from 'dotenv';
import matter from 'gray-matter';

// Setup environment
dotenv.config();

// Paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(__dirname, 'posts');
const PAGES_DIR = join(__dirname, 'pages');
const STATIC_DIR = join(__dirname, 'static');
const ENV_FILE = join(__dirname, '.env');

// Cache settings
const contentCache = {
  posts: null,
  pages: null,
  dirHash: null,
  etags: new Map(),
  lastCheck: 0
};

// settings
const PORT = parseInt(process.env.PORT || '3000', 10)
const CACHE_CHECK_INTERVAL = 5000 // check every 5 seconds
const PAGINATION_LIMIT = parseInt(process.env.PAGINATION_LIMIT || '5', 10)
const PREVIEW_DRAFTS = process.env.PREVIEW_DRAFTS === 'true'
const RSS_TITLE = process.env.RSS_TITLE || process.env.BLOG_TITLE
const RSS_DESCRIPTION = process.env.RSS_DESCRIPTION || process.env.BLOG_DESCRIPTION

// Configure marked options
marked.setOptions({
  highlight: function(code, lang) {
    return code;
  },
  gfm: true,
  breaks: true,
  headerIds: true,
  langPrefix: '',
  mangle: false,
  headerPrefix: '',
  pedantic: false
});

function renderTOC(toc) {
  if (!toc || toc.length === 0) return ''
  
  return `
<div class="toc">
  ${toc.map(item => `
    <div class="toc-item" style="padding-left: ${item.level * 1.5}em">
      <a href="#${item.id}">${item.text}</a>
    </div>
  `).join('')}
</div>
<div class="divider">---</div>
  `
}

function processMarkdown(markdown, title) {
  let lines = markdown.split('\n')
  let result = []
  let skipNextH1 = false // Flag to skip the first h1 if it matches title
  let inCodeBlock = false
  let codeBlockContent = []
  let codeBlockLang = ''
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    
    // Handle code blocks
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        // Start of code block
        inCodeBlock = true
        codeBlockContent = []
        codeBlockLang = line.trim().slice(3)
      } else {
        // End of code block
        inCodeBlock = false
        let code = codeBlockContent
          .join('\n')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        result.push(`<pre><code class="language-${codeBlockLang}">${code}</code></pre>`)
      }
      continue
    }
    
    if (inCodeBlock) {
      // Preserve exact line content for code blocks
      codeBlockContent.push(line)
      continue
    }
    
    if (line.startsWith('#')) {
      let level = line.match(/^#+/)[0].length
      let text = line.replace(/^#+\s+/, '')
      let id = text.toLowerCase()
        .replace(/[^\w\- ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
      
      // Skip this h1 if it matches the title
      if (level === 1 && text === title && !skipNextH1) {
        skipNextH1 = true
        continue
      }
      
      if (level === 1) {
        // Create ASCII art box for h1
        let width = text.length + 4
        let top = `╔${'═'.repeat(width)}╗`
        let middle = `║  ${text}  ║`
        let bottom = `╚${'═'.repeat(width)}╝`
        
        result.push(`<h1 id="${id}">`)
        result.push(`<pre class="h1-box">`)
        result.push(top)
        result.push(middle)
        result.push(bottom)
        result.push(`</pre>`)
        result.push(`</h1>`)
      } else if (level === 2) {
        // Add single-line box for h2
        let width = text.length + 2
        let box = `┌${'─'.repeat(width)}┐\n│ ${text} │\n└${'─'.repeat(width)}┘`
        result.push(`<h2 id="${id}"><pre class="h2-box">${box}</pre></h2>`)
      } else if (level === 3) {
        // Add simple underline for h3
        result.push(`<h3 id="${id}"><u>${text}</u></h3>`)
      } else {
        result.push(`<h${level} id="${id}">${text}</h${level}>`)
      }
    } else {
      result.push(line)
    }
  }
  
  return result.join('\n')
}

async function getDirectoryHash(dir) {
  try {
    let files = await readdir(dir)
    let hash = createHash('md5')
    
    for (let file of files.sort()) {
      let stats = await stat(join(dir, file))
      if (stats) {
        hash.update(file + stats.mtimeMs.toString())
      }
    }
    
    return hash.digest('hex')
  } catch (err) {
    console.error('Error generating directory hash:', err)
    return null
  }
}

async function shouldReloadCache() {
  if (Date.now() - contentCache.lastCheck < CACHE_CHECK_INTERVAL) {
    return false
  }

  contentCache.lastCheck = Date.now()
  
  try {
    // Check for content changes
    let newDirHash = await getDirectoryHash(POSTS_DIR)
    
    if (!contentCache.dirHash || newDirHash !== contentCache.dirHash) {
      contentCache.dirHash = newDirHash
      return true
    }
  } catch (err) {
    console.error('Error checking for changes:', err)
    return true // reload on error to be safe
  }
  
  return false
}

function generateETag(content) {
  return createHash('md5').update(JSON.stringify(content)).digest('hex');
}

function extractDescription(content) {
  let firstParagraph = content.split('\n\n')[0];
  return firstParagraph.replace(/[#*`]/g, '').trim();
}

function generateTOC(content) {
  let toc = []
  let lines = content.split('\n')
  let minLevel = 6
  
  // find minimum header level
  lines.forEach(line => {
    if (line.startsWith('#')) {
      let level = line.match(/^#+/)[0].length
      minLevel = Math.min(minLevel, level)
    }
  })
  
  lines.forEach(line => {
    if (line.startsWith('#')) {
      let level = line.match(/^#+/)[0].length
      let text = line.replace(/^#+\s+/, '')
      let id = text.toLowerCase()
        .replace(/[^\w\- ]/g, '') // Remove special chars except hyphen and space
        .replace(/\s+/g, '-')     // Replace spaces with hyphens
        .replace(/-+/g, '-')      // Collapse multiple hyphens
        .replace(/^-+|-+$/g, '')  // Remove leading/trailing hyphens
      toc.push({
        level: level - minLevel,
        text,
        id
      })
    }
  })
  
  return toc
}

async function getContent() {
  if (!await shouldReloadCache() && contentCache.posts && contentCache.pages) {
    return { 
      posts: contentCache.posts, 
      pages: contentCache.pages 
    }
  }

  let postFiles = await readdir(POSTS_DIR)
  let posts = await Promise.all(
    postFiles
      .filter(file => file.endsWith('.md'))
      .map(async filename => {
        let content = await readFile(join(POSTS_DIR, filename), 'utf-8')
        let { data, content: markdown } = matter(content)
        
        // skip draft posts unless in preview mode
        if (data.draft && !PREVIEW_DRAFTS) return null
        
        let slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', '')
        let description = extractDescription(markdown)
        let toc = data.toc ? generateTOC(markdown) : null
        
        // Process markdown for header styling, passing the title to skip duplicate h1
        markdown = processMarkdown(markdown, data.title)
        let html = marked(markdown)
        
        let post = {
          ...data,
          slug,
          content: markdown,
          html,
          url: `${process.env.BLOG_URL}/${slug}`,
          description,
          toc
        }
        
        contentCache.etags.set(slug, generateETag(post))
        return post
      })
  )

  // filter out null (draft) posts
  posts = posts.filter(Boolean)

  let pageFiles = await readdir(PAGES_DIR)
  let pages = await Promise.all(
    pageFiles
      .filter(file => file.endsWith('.md'))
      .map(async filename => {
        let content = await readFile(join(PAGES_DIR, filename), 'utf-8')
        let { data, content: markdown } = matter(content)
        
        // skip draft pages unless in preview mode
        if (data.draft && !PREVIEW_DRAFTS) return null
        
        let slug = filename.replace('.md', '')
        let toc = data.toc ? generateTOC(markdown) : null
        
        // Process markdown for header styling, passing the title to skip duplicate h1
        markdown = processMarkdown(markdown, data.title)
        let html = marked(markdown)
        
        let page = {
          ...data,
          slug,
          content: markdown,
          html,
          url: `${process.env.BLOG_URL}/${slug}`
        }
        
        contentCache.etags.set(slug, generateETag(page))
        return page
      })
  )

  // filter out null (draft) pages
  pages = pages.filter(Boolean)

  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  
  contentCache.posts = posts
  contentCache.pages = pages
  
  return { posts, pages }
}

function generateRSS(posts) {
  let feed = new Feed({
    title: RSS_TITLE,
    description: RSS_DESCRIPTION,
    id: process.env.BLOG_URL,
    link: process.env.BLOG_URL,
    language: process.env.RSS_LANGUAGE,
    image: `${process.env.BLOG_URL}${process.env.OG_IMAGE}`,
    favicon: `${process.env.BLOG_URL}/static/favicon.svg`,
    copyright: `All rights reserved ${new Date().getFullYear()}, ${process.env.BLOG_AUTHOR}`,
    author: {
      name: process.env.BLOG_AUTHOR,
      link: process.env.BLOG_URL
    }
  });

  posts.forEach(post => {
    if (!post.draft || PREVIEW_DRAFTS) {
      feed.addItem({
        title: post.title,
        id: post.url,
        link: post.url,
        description: post.description,
        content: post.html,
        author: [{ name: post.author }],
        date: new Date(post.date)
      });
    }
  });

  return feed.rss2();
}

function generateSitemap(posts, pages) {
  let urls = [
    ...posts.map(post => post.url),
    ...pages.map(page => page.url)
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(url => `
    <url>
      <loc>${url}</loc>
      <changefreq>weekly</changefreq>
    </url>
  `).join('')}
</urlset>`;
}

let styles = `
  body { 
    max-width: 65ch;
    margin: 15px;
    padding: 0;
    font-family: ${process.env.THEME_FONT_FAMILY};
    font-size: 13px;
    line-height: 1.5;
    background: ${process.env.THEME_BACKGROUND};
    color: ${process.env.THEME_TEXT};
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }
  * {
    box-sizing: border-box;
  }
  a, a:hover, a:visited, nav a:visited {
    color: ${process.env.THEME_LINK};
    text-decoration: underline;
  }
  pre, code {
    font-family: inherit;
    background: #111111;
    color: #ffffff;
    padding: 1em;
    margin: 1em 0;
    overflow-x: auto;
    font-size: inherit;
    line-height: inherit;
    white-space: pre;
  }
  code {
    padding: 0.2em;
    margin: 0;
    background: #111111;
  }
  pre code {
    padding: 0;
    background: none;
  }
  h1, h2, h3 {
    font-size: inherit;
    font-weight: inherit;
    margin: 1.5em 0 0.2em;
  }
  
  .h1-box {
    margin: 0;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    background: none;
    color: inherit;
    white-space: pre;
  }
  
  .h2-box {
    margin: 0;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    background: none;
    color: inherit;
    white-space: pre;
  }
  
  h3 u {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    opacity: 0.8;
  }
  
  h1 + p, h2 + p, h3 + p {
    margin-top: 1em;
  }
  .post-preview {
    margin: 1.5em 0;
  }
  .post-preview h2 {
    margin: 0;
  }
  .post-preview .metadata {
    margin: 0.2em 0;
  }
  .post-preview .tags {
    margin-top: 0.2em;
    display: block;
  }
  .tags span {
    margin-right: 1em;
  }
  .metadata {
    margin: 0 0 2em 0;
  }
  .tags {
    margin: 0;
  }
  .tags span {
    margin-right: 1em;
  }
  nav {
    margin: 0 0 2em 0;
    text-transform: lowercase;
  }
  nav a {
    margin-right: 1.5em;
  }
  .divider {
    white-space: pre;
    color: ${process.env.THEME_TEXT};
    opacity: 0.5;
    margin: 1.5em 0;
  }
  .pagination {
    margin: 2em 0;
  }
  .pagination a, .pagination span {
    margin-right: 1em;
  }
  .current-page {
    color: ${process.env.THEME_TEXT};
    opacity: 0.5;
  }
  p {
    margin: 1em 0;
  }
  .toc {
    margin: 2em 0;
  }
  .toc-item {
    margin: 0.5em 0;
  }
  .toc-item a {
    text-decoration: none;
  }
  .toc-item a:hover {
    text-decoration: underline;
  }
  .draft-notice {
    color: ${process.env.THEME_TEXT};
    opacity: 0.7;
    margin: 1em 0;
  }
  .draft-tag {
    opacity: 0.7;
    margin-left: 1em;
  }
  .ascii-title {
    margin: 0 0 1em 0;
    padding: 0;
    font-family: inherit;
    font-size: 0.8em;
    line-height: 1.2;
    background: none;
    color: inherit;
    white-space: pre;
    display: block;
  }
  
  .ascii-title a {
    color: inherit;
    text-decoration: none;
  }
  h1 {
    margin: 0 0 0.5em 0;
  }
  
  ul {
    list-style: square;
    padding-left: 15px;
    margin: 1em 0;
  }
  
  ul ul {
    padding-left: 2em;
  }
  
  li {
    margin: 0.5em 0;
  }
  
  pre {
    font-family: inherit;
    background: #111111;
    color: #ffffff;
    padding: 1em;
    margin: 1em 0;
    overflow-x: auto;
    font-size: inherit;
    line-height: 1.4;
    white-space: pre;
  }
  
  pre code {
    padding: 0;
    margin: 0;
    font-size: inherit;
    line-height: inherit;
    white-space: pre;
    background: none;
    border: none;
    display: block;
  }
  
  code {
    font-family: inherit;
    background: #111111;
    color: #ffffff;
    padding: 0.2em;
    margin: 0;
    font-size: inherit;
    line-height: inherit;
    white-space: pre;
  }
`

function renderHeader(currentPath = '') {
  return `
    <div class="ascii-title-placeholder"></div>
    <nav>
      <a href="/">Index</a>
      ${getVisiblePages().map(page => `<a href="/${page.slug}">${page.slug}</a>`).join(' ')}
      ${process.env.SHOW_RSS !== 'false' ? ' <a href="/rss.xml">RSS</a>' : ''}
      ${process.env.BLOG_GITHUB && process.env.SHOW_GITHUB !== 'false' ? 
        ' <a href="https://github.com/${process.env.BLOG_GITHUB}">GitHub</a>' : ''}
      ${process.env.BLOG_TWITTER && process.env.SHOW_TWITTER !== 'false' ? 
        ' <a href="https://twitter.com/${process.env.BLOG_TWITTER}">Twitter</a>' : ''}
    </nav>
  `
}

function getVisiblePages() {
  return contentCache.pages.filter(page => !page.hidden)
}

function renderIndex(posts, page = 1) {
  let start = (page - 1) * PAGINATION_LIMIT;
  let end = start + PAGINATION_LIMIT;
  let totalPages = Math.ceil(posts.length / PAGINATION_LIMIT);
  let paginatedPosts = posts.slice(start, end);

  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${process.env.BLOG_TITLE}</title>
    <meta name="description" content="${process.env.BLOG_DESCRIPTION}">
    <link rel="alternate" type="application/rss+xml" title="${RSS_TITLE}" href="/rss.xml">
    ${getFaviconTag()}
    <style>${styles}</style>
</head>
<body>
    ${renderHeader('/')}
    ${PREVIEW_DRAFTS ? '<div class="draft-notice">Draft Preview Mode Enabled</div>' : ''}
    ${paginatedPosts.map(post => `
        <article class="post-preview">
            <h2><a href="/${post.slug}">${post.title}</a></h2>
            <div class="metadata">
                <div class="meta-line">
                    ${new Date(post.date).toISOString().split('T')[0]} - ${post.author}
                    ${post.draft ? '<span class="draft-tag">Draft</span>' : ''}
                </div>
                <div class="tags">
                    ${post.tags.map(tag => `<span>${tag}</span>`).join('')}
                </div>
            </div>
        </article>
    `).join('')}
    ${renderPagination(page, totalPages)}
</body>
</html>
  `

  return html
}

function renderPagination(currentPage, totalPages) {
  if (totalPages <= 1) return ''
  
  let pages = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      pages.push(`<span class="current-page">${i}</span>`)
    } else {
      pages.push(`<a href="/?page=${i}">${i}</a>`)
    }
  }
  
  return `<div class="pagination">${pages.join('')}</div>`
}

function getFaviconTag() {
  if (process.env.FAVICON_SVG) {
    return `<link rel="icon" type="image/svg+xml" href="${process.env.FAVICON_SVG}">`
  }
  if (process.env.FAVICON_PATH) {
    return `<link rel="icon" href="${process.env.FAVICON_PATH}">`
  }
  if (process.env.FAVICON_BASE64) {
    return `<link rel="icon" href="${process.env.FAVICON_BASE64}">`
  }
  return ''
}

function renderPost(post) {
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${post.title} - ${process.env.BLOG_TITLE}</title>
    <meta name="description" content="${post.description}">
    <meta property="og:title" content="${post.title}">
    <meta property="og:description" content="${post.description}">
    <meta property="og:image" content="${process.env.BLOG_URL}${process.env.OG_IMAGE}">
    ${getFaviconTag()}
    <style>${styles}</style>
</head>
<body>
    ${renderHeader()}
    <article>
        <h1>
          <pre class="h1-box">
╔${'═'.repeat(post.title.length + 4)}╗
║  ${post.title}  ║
╚${'═'.repeat(post.title.length + 4)}╝</pre>
        </h1>
        <div class="metadata">
            ${new Date(post.date).toISOString().split('T')[0]} - ${post.author}
            ${post.draft ? '<span class="draft-tag">Draft</span>' : ''}
            <div class="tags">
                ${post.tags.map(tag => `<span>${tag}</span>`).join('')}
            </div>
        </div>
        ${post.toc ? renderTOC(post.toc) : ''}
        ${marked(post.content)}
    </article>
</body>
</html>
  `

  return html
}

function renderPage(page) {
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${page.title} - ${process.env.BLOG_TITLE}</title>
    <meta name="description" content="${page.description || process.env.BLOG_DESCRIPTION}">
    ${getFaviconTag()}
    <style>${styles}</style>
</head>
<body>
    ${renderHeader()}
    <article>
        ${page.html}
    </article>
</body>
</html>
  `

  return html
}

function render404() {
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Not Found - ${process.env.BLOG_TITLE}</title>
    ${getFaviconTag()}
    <style>${styles}</style>
</head>
<body>
    ${renderHeader()}
    <h1>404 - Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
</body>
</html>
  `

  return html
}

function render500(error) {
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>500 - Server Error - ${process.env.BLOG_TITLE}</title>
    ${getFaviconTag()}
    <style>${styles}</style>
</head>
<body>
    ${renderHeader()}
    <h1>500 - Server Error</h1>
    <p>Something went wrong on our end.</p>
    ${error ? `<pre>${error}</pre>` : ''}
</body>
</html>
  `

  return html
}

// Add this function to load ASCII art
async function loadAsciiTitle() {
  if (process.env.ASCII_TITLE_PATH) {
    const asciiPath = join(__dirname, process.env.ASCII_TITLE_PATH);
    if (existsSync(asciiPath)) {
      try {
        const ascii = await readFile(asciiPath, 'utf-8');
        return `<pre class="ascii-title"><a href="/">${ascii.trimEnd()}</a></pre>`;
      } catch (err) {
        console.error('Error loading ASCII title:', err);
      }
    }
  }
  return `<h1><a href="/">${process.env.BLOG_TITLE}</a></h1>`;
}

// Helper function to inject ASCII title
async function injectAsciiTitle(html) {
  const asciiTitle = await loadAsciiTitle();
  return html.replace('<div class="ascii-title-placeholder"></div>', asciiTitle);
}

const app = express();

// Enable compression
app.use(compression());

// Serve static files
app.use('/static', express.static(STATIC_DIR, {
  maxAge: '1d',
  etag: true
}));

// Routes
app.get('/', async (req, res) => {
  try {
    let page = parseInt(req.query.page || '1', 10);
    let { posts } = await getContent();
    let html = renderIndex(posts, page);
    html = await injectAsciiTitle(html);
    res.send(html);
  } catch (err) {
    console.error('Error rendering index:', err);
    res.status(500).send(render500(err));
  }
});

app.get('/rss.xml', async (req, res) => {
  try {
    let { posts } = await getContent()
    let xml = generateRSS(posts)
    
    res.type('application/xml')
    res.send(xml)
  } catch (err) {
    console.error('Error generating RSS:', err)
    res.status(500).send(render500(err))
  }
})

app.get('/sitemap.xml', async (req, res) => {
  try {
    let { posts, pages } = await getContent()
    let xml = generateSitemap(posts, pages)
    
    res.type('application/xml')
    res.send(xml)
  } catch (err) {
    console.error('Error generating sitemap:', err)
    res.status(500).send(render500(err))
  }
})

app.get('/:slug', async (req, res) => {
  try {
    let { posts, pages } = await getContent()
    let post = posts.find(p => p.slug === req.params.slug)
    let page = pages.find(p => p.slug === req.params.slug)
    
    let html
    if (post) {
      html = renderPost(post)
    } else if (page) {
      html = renderPage(page)
    } else {
      return res.status(404).send(render404())
    }
    
    html = await injectAsciiTitle(html)
    res.send(html)
  } catch (err) {
    console.error('Error rendering post/page:', err)
    res.status(500).send(render500(err))
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
}); 
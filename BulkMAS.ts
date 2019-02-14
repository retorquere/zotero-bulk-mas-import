declare const Zotero: any

function debug(msg) {
  Zotero.debug(`BulkMAS: ${msg}`)
}

function titleColumn(header) {
  return header.findIndex(col => col.toLowerCase().split(' ').includes('title'))
}

function detectImport() {
  const headers = Zotero.read()
  debug(`detectImport: ${headers} = ${titleColumn(headers.split(','))}`)
  return titleColumn(headers.split(',')) >= 0
}

// https://stackoverflow.com/a/12785546/2541040
function parse(csv) {
  const chars = csv.split('')
  let c = 0
  const cc = chars.length
  let start, end, row

  const table = []
  while (c < cc) {
    table.push(row = [])
    while (c < cc && chars[c] !== '\r' && chars[c] !== '\n') {
      start = end = c
      if (chars[c] === '"') {
        start = end = ++c

        while (c < cc) {
          if (chars[c] === '"') {
            if (chars[c + 1] !== '"') {
              break
            } else {
              chars[++c] = '' // unescape ""
            }
          }
          end = ++c
        }

        if (chars[c] === '"') ++c

        while (c < cc && chars[c] !== '\r' && chars[c] !== '\n' && chars[c] !== ',') ++c

      } else {
        while (c < cc && chars[c] !== '\r' && chars[c] !== '\n' && chars[c] !== ',') end = ++c

      }

      row.push(chars.slice(start, end).join(''))
      if (chars[c] === ',') ++c
    }

    if (chars[c] === '\r') ++c
    if (chars[c] === '\n') ++c
  }
  return table
}

function li(str) {
  return `<li>${str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
  }</li>`
}

function importer(): any {
  // lifting the class out of the global scope because the Zotero sandbox does not like global constants/classes: "redeclaration of let BulkMAS"
  class BulkMAS {
    private key: string
    private uri: string

    constructor() {
      this.key = Zotero.getHiddenPref('bulkmas.key')
      if (!this.key) throw new Error('Ocp-Apim-Subscription-Key not set in extensions.zotero.translators.bulkmas.key')

      this.uri = 'https://api.labs.cognitive.microsoft.com/academic/v1.0/evaluate?count=1&attributes=Id,Y,D,W,E&expr='
    }

    public async importItem(title) {
      if (!title) throw new Error('no title')

      const mas: any = await this.getURI(this.uri + encodeURIComponent(`Ti='${title.toLowerCase().replace(/'/g, '')}'`))
      const article = mas && mas.entities && mas.entities.length ? mas.entities[0] : null
      if (!article) throw new Error('no matches found')

      // https://docs.microsoft.com/en-us/azure/cognitive-services/academic-knowledge/entityattributes
      article.E = article.E ? JSON.parse(article.E) : {}

      const itemType = article.C && article.C.CN ? 'conferencePaper' : 'journalArticle'
      const item = new Zotero.Item(itemType)

      item.date = article.D || article.Y
      item.tags = article.W || []

      item.title = article.E.DN
      if (article.E.S) item.url = article.E.S[0].U

      if (article.E.ANF) item.creators = article.E.ANF.sort((a, b) => a.S - b.S).map(author => ({ lastName: author.LN, firstName: author.FN, creatorType: 'author' }))

      item.DOI = article.E.DOI

      item.pages = [article.E.FP, article.E.LP].filter(p => p).join('-')

      item[itemType === 'journalArticle' ? 'issue' : 'series'] = article.E.I

      if (article.E.IA) {
        const abstract = []
        for (const [word, positions] of Object.entries(article.E.IA.InvertedIndex)) {
          for (const pos of (positions as number[])) {
            abstract[pos] = word
          }
        }
        item.abstractNote = abstract.join(' ')
      }

      if (itemType === 'journalArticle') {
        item.publicationTitle = article.E.BV
        item.seriesTitle = article.E.VFN
      } else {
        item.publicationTitle = article.E.VFN
      }

      item.volume = article.E.V

      await item.complete()
    }

    private getURI(url) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url)
        xhr.setRequestHeader('Ocp-Apim-Subscription-Key', this.key)

        xhr.onload = function() {
          if (this.status >= 200 && this.status < 300) { // tslint:disable-line:no-magic-numbers
            try {
              resolve(JSON.parse(xhr.response))

            } catch (err) {
              reject(err.message || `${err}`)

            }

          } else {
            reject(`${this.status} (${xhr.statusText})`)

          }
        }

        xhr.onerror = function() {
          debug(`${url}: ${this.status} (${xhr.statusText})`)
          reject(`${this.status} (${xhr.statusText})`)
        }

        xhr.send()
      })
    }
  }

  return new BulkMAS
}

/*
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
*/
// Zotero sandbox does not allow setTimeout... oy
function delay(milliseconds) {
  const start = new Date().getTime()
  while ((new Date().getTime() - start) < milliseconds) {
    // busy waiting...
  }
}

async function doImportAsync() {
  let rateLimit
  const defaultRateLimit = 1500

  try {
    rateLimit = Zotero.getHiddenPref('bulkmas.delay') || defaultRateLimit
  } catch (err) {
    rateLimit = defaultRateLimit
  }

  const mas = importer()

  let _chunk
  let csv
  while (_chunk = Zotero.read(1024)) { // tslint:disable-line:no-magic-numbers
    csv += _chunk
  }

  const items = parse(csv)

  const titleCol = titleColumn(items.shift())

  Zotero.setProgress(0)

  let imported = 0
  const errors = []
  // await Promise.all(requests) // immediately hits the one-per-second rate limit
  for (const item of items) {
    imported += 1

    const title = item[titleCol]
    if (title) {
      try {
        await mas.importItem(title)

      } catch (err) {
        errors.push(`${title}: ${err}`)
        await delay(rateLimit) // assume we've hit a rate limit and add one extra delay cycle

      }

      debug(`waiting ${rateLimit}ms...`)
      await delay(rateLimit)
      debug('proceeding')
    }

    Zotero.setProgress((imported / items.length) * 100) // tslint:disable-line:no-magic-numbers
  }

  if (errors.length > 0) {
    const item = new Zotero.Item('note')
    item.note = `Import errors found: <ul>${errors.map(li).join('\n')}</ul>`
    await item.complete()
  }
}

// https://groups.google.com/forum/#!topic/zotero-dev/G9RGcnFkPyc
async function doImport() {
  try {
    await doImportAsync()
  } catch (err) {
    const item = new Zotero.Item('note')
    item.note = `Import errors found: <p>${err}</p>`
    await item.complete()
    debug(err)
  }
}

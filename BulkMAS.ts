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

function importer(): any {
  // lifting the class out of the global scope because the Zotero sandbox does not like global constants/classes: "redeclaration of let BulkMAS"
  class BulkMAS {
    private key: string
    private interpret: string
    private evaluate: string
    private delay: number

    constructor() {
      this.key = Zotero.getHiddenPref('bulkmas.key')
      if (!this.key) throw new Error('Ocp-Apim-Subscription-Key not set in extensions.zotero.translators.bulkmas.key')

      this.interpret = 'https://api.labs.cognitive.microsoft.com/academic/v1.0/interpret?query='
      this.evaluate = 'https://api.labs.cognitive.microsoft.com/academic/v1.0/evaluate?count=1&attributes=Id,Y,D,W,E&expr='

      try {
        this.delay = Zotero.getHiddenPref('bulkmas.delay') || 1
      } catch (err) {
        this.delay = 1
      }
      if (this.delay > 1000) this.delay = Math.round(this.delay / 1000) // tslint:disable-line:no-magic-numbers
      if (this.delay < 1) this.delay = 1
    }

    public async sleep() {
      // await new Promise(resolve => setTimeout(resolve, this.delay * 1000)) // tslint:disable-line:no-magic-numbers

      // setTimeout is not available in translators, so...

      /*
      const start = new Date().getTime()
      const ms = this.delay * 1000
      while ((new Date().getTime() - start) > ms) {
        // wait
      }
      */

      await this.getJSON(`https://reqres.in/api/users?delay=${this.delay}`)
    }

    public async importItem(title) {
      if (!title) throw new Error('no title')

      await this.sleep()

      const interpret: any = await this.getJSON(this.interpret + encodeURIComponent(title))
      if (!interpret) throw new Error('no response on interpret')
      let query = null
      for (const interpretation of interpret.interpretations) {
        for (const rule of interpretation.rules) {
          if (rule.name === '#GetPapers' && rule.output.type === 'query') query = rule.output.value
          if (query) break
        }
        if (query) break
      }
      if (!query) throw new Error('no query from interpret')

      const evaluate: any = await this.getJSON(this.evaluate + encodeURIComponent(query))
      const article = evaluate && evaluate.entities && evaluate.entities.length ? evaluate.entities[0] : null
      if (!article) throw new Error('no matches found')

      // https://docs.microsoft.com/en-us/azure/cognitive-services/academic-knowledge/entityattributes
      article.E = article.E ? JSON.parse(article.E) : {} // for some reason this is sent out as a JSON-encoded-JSON-encoded string

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

    private getJSON(url) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url)
        xhr.setRequestHeader('Ocp-Apim-Subscription-Key', this.key)

        xhr.onload = function() {
          if (this.status >= 200 && this.status < 300) { // tslint:disable-line:no-magic-numbers
            try {
              resolve(JSON.parse(xhr.response))

            } catch (err) {
              debug(`${url}: ${err.message || err}`)
              reject(err.message || `${err}`)

            }

          } else {
            debug(`${url}: ${this.status} (${xhr.statusText})`)
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

function htmlEncode(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function error_tr(err) {
  return `<tr><td>${htmlEncode(err.title)}</td><td>${htmlEncode(err.message)}</td></tr>`
}

async function doImportAsync() {
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
        debug(`imported ${title}`)

      } catch (err) {
        debug(err)
        errors.push({ title, message: `${err}` })
        await mas.sleep() // assume we've hit a rate limit and add one extra delay cycle

      }

    } else{
      debug(`${imported}: no title, skipping`)
    }

    Zotero.setProgress((imported / items.length) * 100) // tslint:disable-line:no-magic-numbers
  }

  if (errors.length > 0) {
    const item = new Zotero.Item('note')
    item.note = `Microsoft Academic Search import errors:<br><table>${errors.map(error_tr).join('\n')}</table>`
    await item.complete()
  }
}

// https://groups.google.com/forum/#!topic/zotero-dev/G9RGcnFkPyc
async function doImport() {
  try {
    await doImportAsync()
  } catch (err) {
    const item = new Zotero.Item('note')
    item.note = `Microsoft Academic Search import error:<br>${err}`
    await item.complete()
    debug(err)
  }
}

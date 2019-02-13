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
    private uri: string

    constructor() {
      this.key = Zotero.getHiddenPref('bulkmas.key')
      if (!this.key) throw new Error('Ocp-Apim-Subscription-Key not set in extensions.zotero.translators.bulkmas.key')

      this.uri = 'https://api.labs.cognitive.microsoft.com/academic/v1.0/evaluate?count=1&attributes=Id,Y,D,W,E&expr='
    }

    public async importItem(title) {
      if (!title) return

      const mas: any = await this.getURI(this.uri + encodeURIComponent(`Ti='${title.replace(/'/g, '')}'`))
      const article = mas && mas.entities && mas.entities.length ? mas.entities[0] : null
      if (!article) return

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
        item.abstractNode = abstract.join(' ')
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
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', url)
        xhr.setRequestHeader('Ocp-Apim-Subscription-Key', this.key)

        xhr.onload = function() {
          if (this.status >= 200 && this.status < 300) { // tslint:disable-line:no-magic-numbers
            try {
              resolve(JSON.parse(xhr.response))

            } catch (err) {
              debug(`url: ${err})`)
              resolve(null)

            }

          } else {
            debug(`url: ${this.status} (${xhr.statusText})`)
            resolve(null)

          }
        }

        xhr.onerror = function() {
          debug(`url: ${this.status} (${xhr.statusText})`)
          resolve(null)
        }

        xhr.send()
      })
    }
  }

  return new BulkMAS
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

  const requests = items.map(item => mas.importItem(item[titleCol]))
  // await Promise.all(requests) // microsoft does *not* like this -- immediate 429 too many requests
  for (const req of requests) {
    await req
  }
}

// https://groups.google.com/forum/#!topic/zotero-dev/G9RGcnFkPyc
async function doImport() {
  try {
    await doImportAsync()
  } catch (err) {
    debug(err)
  }
}

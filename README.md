Bulk import from Microsoft Academic search by searching on title. Grab the latest release [here](https://github.com/retorquere/zotero-bulk-mas-import/releases/latest), drop it into your translators directory, and import a CSV file that has at least one column called `title`. The importer will search these titles on MAS, and will add the first hit it gets for each as a new item in Zotero.

If you see less items then you expect, enable Debug Output Logging from the Help menu and look for lines with `BulkMAS`. At this time I cannot provide feedback on errors until https://groups.google.com/forum/#!topic/zotero-dev/G9RGcnFkPyc is resolved.

Set the [hidden preference](https://www.zotero.org/support/preferences/hidden_preferences) `extensions.zotero.translators.bulkmas.key` to your [Microsoft Academic Knowledge API key](https://labs.cognitive.microsoft.com/en-us/subscriptions?productId=/products/5636d970e597ed0690ac1b3f&source=labs)


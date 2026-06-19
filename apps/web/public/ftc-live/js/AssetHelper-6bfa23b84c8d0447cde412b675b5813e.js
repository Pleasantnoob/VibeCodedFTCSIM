class AssetHelperClass {
    constructor () {

    }

    async ensureProperties () {
        if(this.assetManifest) {
            return;
        }
        const response = await fetch('/assets/manifest')
        const parsedResponse = await response.json()
        this.useHashedAssets = parsedResponse.useHashedAssets
        this.assetManifest = parsedResponse.assetManifest
        this.baseUrl = parsedResponse.baseUrl
    }

    async path(asset) {
        await this.ensureProperties()
        let realBaseUrl = "/"
        if(this.baseUrl != null) {
            realBaseUrl = this.baseUrl
        }
        if(!this.useHashedAssets) {
            return realBaseUrl + asset + '?_magic_=_ASSET_HELPER_'
        }
        const hashedUrl = this.assetManifest[asset];
        if(!hashedUrl) {
            throw `Asset ${asset} not found!`
        }
        return realBaseUrl + hashedUrl
    }

    async setCssProperties() {
        await this.ensureProperties()
        const styleEl = document.createElement('style');
        document.head.appendChild(styleEl);
        const styleSheet = styleEl.sheet;
        let rules = ''
        for (const asset of Object.keys(this.assetManifest)) {
            rules += `--${asset.replaceAll(/[^A-Za-z0-9_-]/g, '-')}: url("${await this.path(asset)}");\n`
        }
        styleSheet.insertRule(`:root {\n${rules}\n}`, 0);
    }
}

const AssetHelper = new AssetHelperClass();

if (typeof loadAssets === "function") {
    loadAssets();
}

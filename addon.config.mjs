const addonConfig = {
    id: '708d64df-6691-4659-acdc-4351765e2d12',
    directoryName: '708d64df-6691-4659-acdc-4351765e2d12',
    name: 'YandexMusicTime',
    description: 'Отображает время, проведенное в Яндекс Музыке',
    version: '3.0.0',
    author: ['dobryjigrok', 'dieugh'],
    type: 'web-addon',
    image: 'Assets/logo.png',
    banner: 'Assets/banner.png',
    libraryLogo: 'Assets/logo.png',
    tags: ['script', 'time', 'statistics', 'utility'],
    dependencies: [],
    allowedUrls: [],
    supportedVersions: [],
    cssScope: 'global',
    requirements: {
        minHostApi: 1,
        capabilities: ['lifecycle-v1', 'async-start-v1', 'net-per-addon-v1', 'typed-settings-v1'],
    },
}

export default addonConfig

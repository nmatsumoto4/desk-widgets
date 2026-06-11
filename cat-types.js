// 猫の種類定義。ここにエントリを足すだけで新しい猫を追加できる。
// base: 体色 / belly: お腹・マズル / patchA, patchB: ぶち模様の色
// stripes: しま模様の色 / tie: ネクタイ色（ビジネス猫） / eye: 瞳の色

window.CAT_TYPES = [
  {
    id: 'mike',
    name: '三毛猫',
    base: '#f6f1e7',
    belly: '#ffffff',
    patchA: '#e8973f',
    patchB: '#4a4440',
    eye: '#4a6b3a'
  },
  {
    id: 'kuro',
    name: '黒猫',
    base: '#3d3a40',
    belly: '#56525a',
    eye: '#e8bc30'
  },
  {
    id: 'shiro',
    name: '白猫',
    base: '#f8f5ee',
    belly: '#ffffff',
    eye: '#5b8bc7'
  },
  {
    id: 'chatora',
    name: '茶トラ',
    base: '#e8a04e',
    belly: '#f6dab2',
    stripes: '#c47c2a',
    eye: '#7a5c2e'
  },
  {
    id: 'gray',
    name: 'グレー猫',
    base: '#9aa0a8',
    belly: '#c5c9cf',
    stripes: '#7d838d',
    eye: '#caa53d'
  },
  {
    id: 'biz',
    name: 'ビジネス猫',
    base: '#f8f5ee',
    belly: '#ffffff',
    patchA: '#6d6a72',
    tie: '#c0392b',
    eye: '#3d6b8f'
  }
];

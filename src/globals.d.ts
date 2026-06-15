// アンビエント型定義：レンダラ各スクリプトが window.* グローバルで連携するための共通型。
// （import/export を持たないグローバル宣言ファイル）

/** app.ts がゲームモジュールへ渡すコンテキスト（スコア表示・オーバーレイ操作） */
interface WidgetCtx {
  showOverlay(title: string, sub: string): void;
  hideOverlay(): void;
  setScores(score: number | string, best: number | string, info?: string): void;
}

/** 各ゲームウィジェットが満たす共通インターフェース */
interface WidgetModule {
  name: string;
  show(): void;
  hide(): void;
  setAuto(on: boolean): void;
  key(e: KeyboardEvent): boolean | void;
  relayout(): void;
  reset?(): void;
  isOver?(): boolean;
  /** テスト/デバッグ用フック */
  _tick?(): void;
  _state?(): any;
}

type WidgetFactory = (ctx: WidgetCtx) => WidgetModule;

/** preload.ts が contextBridge で公開する API */
interface WidgetAPI {
  newWidget(mode?: string): void;
  toggleHideAll(): void;
  widgetsVisibleCount(): Promise<number>;
  toggleLayer(): void;
  setLayer(top: boolean): void;
  layerOnTop(): Promise<boolean>;
  toggleMute(): void;
  getMuted(): Promise<boolean>;
  onMutedChanged(cb: (muted: boolean) => void): void;
}

interface Window {
  // 効果音シンセ・共通ロジック
  SFX: any;
  Game: any;
  GAME_SIZE: number;
  AI: any;
  Puyo: any;
  PuyoAI: any;
  Rush: any;
  // ゲームウィジェット ファクトリ
  createWidget2048: WidgetFactory;
  createWidgetPuyo: WidgetFactory;
  createWidgetRush: WidgetFactory;
  createWidgetInvaders: WidgetFactory;
  createWidgetBomber: WidgetFactory;
  createWidgetTetris: WidgetFactory;
  createWidgetSnake: WidgetFactory;
  createWidgetLife: WidgetFactory;
  createWidgetBreakout: WidgetFactory;
  createWidgetTD: WidgetFactory;
  createWidgetHero: WidgetFactory;
  createWidgetPac: WidgetFactory;
  createWidgetTron: WidgetFactory;
  // Electron 連携・テストフック
  widgetAPI?: WidgetAPI;
  __widget?: any;
}

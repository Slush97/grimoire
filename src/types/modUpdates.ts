/** Session-only update work owned by the main process. */
export interface ModUpdateManualRequest {
  id: string;
  modId: number;
  modName: string;
  section: string;
  sourceFileIds: number[];
  sourceModIds: string[];
}

export interface ModUpdateError {
  id: string;
  modId: number;
  modName: string;
  message: string;
}

export interface ModUpdateState {
  busy: boolean;
  preparing: boolean;
  manualRequests: ModUpdateManualRequest[];
  errors: ModUpdateError[];
  revision: number;
  affectedModIds: number[];
}

export interface StartModUpdatesArgs {
  modIds: string[];
}

export interface ChooseModUpdateReplacementArgs {
  requestId: string;
  oldFileId: number;
  newFileId: number;
}

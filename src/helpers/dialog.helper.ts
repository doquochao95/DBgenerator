import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { Confirm } from '../common/enums';
import { QuickPickModel } from '../common';

/**
 * Displays a message box with the provided message
 *
 * @param {string} prompt - The prompt to display
 * @param {string} placeHolder - The input placeholder
 * @param {string} currentPath - The current path
 * @param {string} validate - The validation function
 * @example
 * const path = await getPath('Enter a path', 'src/app', 'src/app', (path) => {
 *   if (path.length === 0) {
 *     return 'Path cannot be empty';
 * });
 *
 * @returns {Promise<string | undefined>} - The selected path
 */
export const getPath = async (
  prompt: string,
  placeHolder: string,
  currentPath: string,
  validate: (path: string) => string | undefined,
): Promise<string | undefined> => {
  return await window.showInputBox({
    prompt,
    placeHolder,
    value: currentPath,
    validateInput: validate,
  });
};

/**
 * Displays a message box with the provided message
 *
 * @param {string} prompt - The prompt to display
 * @param {string} placeHolder - The input placeholder
 * @param {string} validate - The validation function
 * @example
 * const name = await getName('Enter a name', 'foo', (name) => {
 *   if (name.length === 0) {
 *     return 'Name cannot be empty';
 * });
 *
 * @returns {Promise<string | undefined>} - The selected name
 */
export const getName = async (
  prompt: string,
  placeHolder: string,
  validate: (name: string) => string | undefined,
): Promise<string | undefined> => {
  return await window.showInputBox({
    prompt,
    placeHolder,
    validateInput: validate,
  });
};
/**
 * Displays a message box with the provided message
 *
 * @param {string[]} items - The list of items to select from
 * @param {string} placeHolder - The input placeholder
 * @example
 * const items = await pickItem(['foo', 'bar'], 'Select some items');
 *
 * @returns {Promise<QuickPickItem[] | undefined>} - The selected items
 */
export const pickManyItems = async (
  items: QuickPickModel[],
  placeHolder: string,
): Promise<QuickPickModel[] | undefined> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      let quickPick = window.createQuickPick()
      quickPick.items = items.map(x => x.item)
      quickPick.placeholder = placeHolder
      quickPick.canSelectMany = true
      quickPick.onDidAccept(() => {
        let selectedItems: QuickPickModel[] = items
          .filter(x => quickPick.selectedItems
            .some(y => (y.label === x.item.label)))
        quickPick.hide()
        resolve(selectedItems);
      });
      quickPick.onDidChangeSelection(() => {
        let selectedItems: QuickPickModel[] = items
          .filter(x => quickPick.selectedItems
            .some(y => (y.label === x.item.label)))
        selectedItems = selectedItems.filter(x => x.info.length > 0)
        quickPick.selectedItems = selectedItems.map(x => x.item)
      });
      quickPick.onDidHide(() => {
        quickPick.dispose()
      });
      quickPick.show()
    }, 1000);
  });
};
/**
 * Displays a message box with the provided message
 *
 * @param {QuickPickItem[]} items - The list of items to select from
 * @param {string} placeHolder - The input placeholder
 * @example
 * const item = await pickItem(['foo', 'bar'], 'Select an item');
 *
 * @returns {Promise<QuickPickItem | undefined>} - The selected item
 */
export const pickSingleItem = async (
  items: QuickPickItem[],
  placeHolder: string,
): Promise<QuickPickItem | undefined> => {
  return new Promise(resolve => {
    setTimeout(() => {
      window.showQuickPick(items, { placeHolder: placeHolder, canPickMany: false }).then(
        selected => {
          resolve(selected);
        }
      );
    }, 1000);
  });
};
export const confirm = async (
  placeHolder: string
): Promise<boolean> => {
  return new Promise(resolve => {
    setTimeout(() => {
      window.showQuickPick([Confirm.YES, Confirm.NO], { placeHolder }).then((res) => {
        res == Confirm.YES ? resolve(true) : resolve(false)
      })
    }, 1000);
  });
}
/**
 * Displays a message box with the provided message
 *
 * @param {string} message - The message to display
 * @example
 * await showMessage('Hello, world!');
 *
 * @returns {Promise<void>} - No return value
 */
export const showMessage = async (message: string): Promise<void> => {
  window.showInformationMessage(message);
};
/**
 * Displays a message box with the provided message
 *
 * @param {string} message - The message to display
 * @example
 * await showError('An error occurred');
 *
 * @returns {Promise<void>} - No return value
 */
export const showError = async (message: string): Promise<void> => {
  window.showErrorMessage(message);
};
/**
 * Displays a message box with the provided message
 *
 * @param {string} message - The message to display
 * @example
 * await showWarning('This is a warning');
 *
 * @returns {Promise<void>} - No return value
 */
export const showWarning = async (message: string): Promise<void> => {
  window.showWarningMessage(message);
};

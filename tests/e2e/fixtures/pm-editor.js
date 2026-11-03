// A real ProseMirror editor, the same engine behind the ChatGPT and Claude composers.
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';

const view = new EditorView(document.getElementById('pm'), {
  state: EditorState.create({ schema, plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo })] }),
});
window.pmText = () => view.state.doc.textBetween(0, view.state.doc.content.size, '\n');
window.pmClear = () => view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));

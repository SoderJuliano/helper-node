// renderer/chatQuestionEditor.js
// Question in-place editor and markdown question header setup.
(function() {
  'use strict';

  const EDIT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M18.0235 10.4646L7.58554 20.9026H2.76801L2.76489 16.0819L13.2029 5.64392L18.0235 10.4646Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.2029 5.64388L15.0004 3.84641C15.7814 3.06536 17.0477 3.06536 17.8288 3.84641L19.821 5.83863C20.6021 6.61968 20.6021 7.88601 19.821 8.66706L18.0235 10.4645V10.4645" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let _editEscHandler = null;

  function _removeEditEscHandler() {
    if (_editEscHandler) {
      document.removeEventListener('keydown', _editEscHandler, true);
      _editEscHandler = null;
    }
  }

  function setQuestionText(el, text) {
    el.dataset.raw = text;
    el.innerHTML = typeof window.renderMarkdown === 'function' ? window.renderMarkdown(text, 'q') : text;
    const ic = document.createElement('span');
    ic.className = 'edit-icon';
    ic.title = 'Editar e reenviar';
    ic.innerHTML = EDIT_ICON_SVG;
    el.appendChild(ic);
  }

  function getQuestionText(questionSpan) {
    return (questionSpan.dataset.raw || questionSpan.textContent).trim();
  }

  function wireQuestionEdit(span) {
    span.addEventListener('click', (e) => {
      if (!e.target.closest('.edit-icon')) return;
      e.stopPropagation();
      handleQuestionEdit(span);
    });
  }

  function handleQuestionEdit(questionSpan) {
    if (window.isEditingQuestion) return;

    window.isEditingQuestion = true;
    const currentText = getQuestionText(questionSpan);

    const container = document.createElement('div');
    container.className = 'edit-container';

    const editField = document.createElement('textarea');
    editField.className = 'edit-textarea';
    editField.rows = 5;
    editField.value = currentText;
    editField.style.width = '100%';
    editField.style.marginBottom = '10px';

    const sendButton = document.createElement('button');
    sendButton.className = 'send-button';
    sendButton.textContent = 'Enviar';
    sendButton.style.marginRight = '10px';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'send-button edit-cancel-btn';
    cancelButton.textContent = 'Cancelar (Esc)';

    const controls = document.createElement('div');
    controls.className = 'edit-controls';
    controls.appendChild(sendButton);
    controls.appendChild(cancelButton);

    container.appendChild(editField);
    container.appendChild(controls);

    const doCancel = () => cancelEditSimple(questionSpan, container, currentText);
    const doSend = () => {
      const newText = editField.value.trim();
      if (newText) finishEdit(newText, container);
      else doCancel();
    };

    sendButton.addEventListener('click', doSend);
    cancelButton.addEventListener('click', doCancel);

    editField.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    _editEscHandler = (e) => {
      if (e.key === 'Escape' && window.isEditingQuestion) {
        e.preventDefault();
        e.stopPropagation();
        doCancel();
      }
    };
    document.addEventListener('keydown', _editEscHandler, true);

    questionSpan.replaceWith(container);
    editField.focus();
  }

  function cancelEditSimple(originalSpan, container, originalText) {
    window.isEditingQuestion = false;
    _removeEditEscHandler();
    setQuestionText(originalSpan, originalText);
    container.replaceWith(originalSpan);
  }

  function finishEdit(newText, container) {
    window.isEditingQuestion = false;
    _removeEditEscHandler();

    if (typeof window.cancelIaAndFreezeStream === 'function') {
      window.cancelIaAndFreezeStream();
    }

    const transcriptionElement = document.getElementById('transcription');
    if (transcriptionElement) {
      const existingStreamingElements = transcriptionElement.querySelectorAll('.streaming-response, .response-text');
      existingStreamingElements.forEach(el => el.remove());
    }

    const questionSpan = document.createElement('span');
    questionSpan.className = 'question-text';
    setQuestionText(questionSpan, newText);
    wireQuestionEdit(questionSpan);

    const parentBlock = container.closest('.interaction-block');
    const newBlock = document.createElement('div');
    newBlock.className = 'interaction-block';
    newBlock.appendChild(questionSpan);
    if (typeof window.createBlockActions === 'function') {
      newBlock.appendChild(window.createBlockActions(document.getElementById('transcription')));
    }

    if (parentBlock) {
      parentBlock.replaceWith(newBlock);
    } else {
      container.replaceWith(newBlock);
    }
    window.currentQuestionElement = questionSpan;

    if (typeof window.startProcessing === 'function') window.startProcessing();
    if (typeof window.sentToAI === 'function') window.sentToAI(newText);
  }

  window.setQuestionText = setQuestionText;
  window.getQuestionText = getQuestionText;
  window.wireQuestionEdit = wireQuestionEdit;
  window.handleQuestionEdit = handleQuestionEdit;
})();

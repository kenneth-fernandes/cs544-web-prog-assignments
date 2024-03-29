import './style.css';

import $ from 'jquery';        //make jquery() available as $
import Meta from './meta.js';  //bundle the input to this program

//default values
const DEFAULT_REF = '_';       //use this if no ref query param
const N_UNI_SELECT = 4;        //switching threshold between radio & select
const N_MULTI_SELECT = 4;      //switching threshold between checkbox & select

/*************************** Utility Routines **************************/

/** Return `ref` query parameter from window.location */
function getRef() {
  const url = new URL(window.location);
  const params = url.searchParams;
  return params && params.get('ref');
}

/** Return window.location url with `ref` query parameter set to `ref` */
function makeRefUrl(ref) {
  const url = new URL(window.location);
  url.searchParams.set('ref', ref);
  return url.toString();
}

/** Return a jquery-wrapped element for tag and attr */
function makeElement(tag, attr = {}) {
  const $e = $(`<${tag}/>`);
  Object.entries(attr).forEach(([k, v]) => $e.attr(k, v));
  return $e;
}

/** Given a list path of accessors, return Meta[path].  Handle
 *  occurrences of '.' and '..' within path.
 */
function access(path) {
  const normalized = path.reduce((acc, p) => {
    if (p === '.') {
      return acc;
    }
    else if (p === '..') {
      return acc.length === 0 ? acc : acc.slice(0, -1)
    }
    else {
      return acc.concat(p);
    }
  }, []);
  return normalized.reduce((m, p) => m[p], Meta);
}

/** Return an id constructed from list path */
function makeId(path) { return ('/' + path.join('/')); }

function getType(meta) {
  return meta.type || 'block';
}

/** Return a jquery-wrapped element <tag meta.attr>items</tag>
 *  where items are the recursive rendering of meta.items.
 *  The returned element is also appended to $element.
 */
function items(tag, meta, path, $element) {
  const $e = makeElement(tag, meta.attr);
  (meta.items || []).
    forEach((item, i) => render(path.concat('items', i), $e));
  $element.append($e);
  return $e;
}

/************************** Event Handlers *****************************/

function setEventHandler(meta, $elem, id, event) {
  const { chkFn: chkFn,
    errMsgFn: errMsgFn,
    attr: attr, required: isRequired,
    type: type, text: text } = meta;

  if (chkFn !== undefined || isRequired) {
    $elem.on(event, function () {
      const errMsgFunc = errMsgFn !== undefined ?
        (val, info) => { return errMsgFn(val, info); } :
        (val, info) => { return 'invalid value' + val; }

      if (type === 'multiSelect' &&
        $(this).children('input').attr('type') === 'checkbox') {
        const values = Array.from(
          $(`input[name=${attr.name}]:checked`)
        ).map(function (item) {
          return item.value;
        });

        const errMsg = values.length !== 0 ?
          '' :
          `The field ${meta.text} must be specified`;

        const errElemId = (id + '-err')
          .replace(/([^a-zA-Z0-9 ])/g, '\\$1');

        $('#' + errElemId).text(errMsg);

      } else {
        const value = $(this).val().trim();

        const errMsg = value.length !== 0 ?
          function (val) {
            return (chkFn !== undefined ? chkFn(val) : true) ?
              '' :
              errMsgFunc(val, meta);
          }(value) :
          `The field ${meta.text} must be specified`;

        const errElemId = (id + '-err')
          .replace(/([^a-zA-Z0-9 ])/g, '\\$1');

        $('#' + errElemId).text(errMsg);
      }
    });

  }
}

/********************** Type Routine Common Handling *******************/

//@TODO


/***************************** Type Routines ***************************/

//A type handling function has the signature (meta, path, $element) =>
//void.  It will append the HTML corresponding to meta (which is
//Meta[path]) to $element.

function block(meta, path, $element) { items('div', meta, path, $element); }

function form(meta, path, $element) {
  const $form = items('form', meta, path, $element);
  $form.submit(function (event) {
    event.preventDefault();
    const $form = $(this);
    $('input,select,textarea', $form).trigger('blur');
    $('input,select', $form).trigger('change');

    const isErrorPresent = Array.from($('.error')).reduce((acc, item) => {
      if (item.innerText.trim().length > 0) {
        acc = true;
      }
      return acc;
    }, false);
    
    if (!isErrorPresent) {
      const serializedArrForm = ($form.serializeArray());
      const results = serializedArrForm.reduce((acc, item) => {
        if (item.name === "multiSelect"
          || item.name === "primaryColors") {
          acc[item.name] = acc.hasOwnProperty(item.name)
            ? acc[item.name] : [];
          acc[item.name].push(item.value);
        }
        else {
          acc[item.name] = item.value;
        }
        return acc;
      }, {});
      console.log(JSON.stringify(results, null, 2));
    }


  });
}

function header(meta, path, $element) {
  const $e = makeElement(`h${meta.level || 1}`, meta.attr);
  $e.text(meta.text || '');
  $element.append($e);
}

function input(meta, path, $element) {
  const inputLabel = meta.required ? meta.text + '*' : meta.text;
  const attr = meta.attr ? meta.attr : {};
  const id = attr.hasOwnProperty('id') ? attr.id : makeId(path);

  $element.append(makeElement('label', { for: id }).text(inputLabel));
  const divElem = makeElement('div');

  if (meta.hasOwnProperty('subType') && meta.subType === 'textarea') {
    divElem.append(makeElement('textarea', attr));
  } else {
    const type = meta.hasOwnProperty('subType') ? meta.subType : 'text';
    divElem.append(makeElement('input',
      Object.assign({}, attr, { id: id, type: type })));
  }
  setEventHandler(meta, divElem.children(), id, 'blur');
  $element.append(divElem.append(
    makeElement('div', { class: 'error', id: id + '-err' })));
}

function link(meta, path, $element) {
  const parentType = getType(access(path.concat('..')));
  const { text = '', ref = DEFAULT_REF } = meta;
  const attr = Object.assign({}, meta.attr || {}, { href: makeRefUrl(ref) });
  $element.append(makeElement('a', attr).text(text));
}

function multiSelect(meta, path, $element) {
  if (meta.items.length >
    (access(['_options']).N_UNI_SELECT || N_UNI_SELECT)) {

    const [id, attr, inputLabel] = initializeElemAttribs(meta, path);

    $element.append(makeElement('label', { for: id }).text(inputLabel));
    const $divElem = makeElement('div');

    const $selectBlckElem = makeElement('select',
      { name: attr.name, multiple: 'multiple' });

    optionItems(meta.items, $selectBlckElem);
    setEventHandler(meta, $selectBlckElem, id, 'change');
    $divElem.append($selectBlckElem)


    $element.append($divElem.append(makeElement('div',
      { class: 'error', id: id + '-err' })));


  } else {
    const [id, attr, inputLabel] = initializeElemAttribs(meta, path);

    $element.append(makeElement('label', { for: id }).text(inputLabel));
    const $divElem = makeElement('div');

    const $fieldSetBlockElem = makeElement('div', { class: 'fieldset' });
    inputItems(meta.items, 'checkbox', id, attr, $fieldSetBlockElem);

    setEventHandler(meta, $fieldSetBlockElem, id, 'change');

    $divElem.append($fieldSetBlockElem);

    $divElem.append(makeElement('div',
      { class: 'error', id: id + '-err' }));

    $element.append($divElem);

  }
}

function para(meta, path, $element) { items('p', meta, path, $element); }

function segment(meta, path, $element) {
  if (meta.text !== undefined) {
    $element.append(makeElement('span', meta.attr).text(meta.text));
  }
  else {
    items('span', meta, path, $element);
  }
}


function submit(meta, path, $element) {
  //Code added - For displaying the Submit button
  const divElem = makeElement('div');
  $element.append(divElem);
  const attr = Object.assign({}, meta.attr,
    { type: 'submit', text: 'Submit' });
  const buttonElem = makeElement('button', attr)
    .text(meta.text ? meta.text : attr.text);
  $element.append(buttonElem);
}

function optionItems(items, $elem) {
  items.forEach((item, index) => {
    $elem.append(makeElement('option', { value: item['key'] }).text(item['text']));
  });
}

function inputItems(items, type, id, attr, $elem) {
  items.forEach((item, index) => {
    const itemAttr = Object.assign({},
      {
        name: attr.name, id: id + '-' + index,
        value: item['key'], type: type
      });
    $elem.append(makeElement('label',
      { for: id }).text(item['key']));
    $elem.append(makeElement('input', itemAttr));
  });
}

function initializeElemAttribs(meta, path) {
  const id = meta.attr.hasOwnProperty('id') ? meta.attr.id : makeId(path);
  return [id,
    Object.assign({}, meta.attr, { for: id }),
    meta.required ? meta.text + '*' : meta.text];
}

function uniSelect(meta, path, $element) {
  if (meta.items.length >
    (access(['_options']).N_UNI_SELECT || N_UNI_SELECT)) {

    const [id, attr, inputLabel] = initializeElemAttribs(meta, path);

    $element.append(makeElement('label', { for: id }).text(inputLabel));
    const $divElem = makeElement('div');

    const $selectBlckElem = makeElement('select', { name: attr.name });

    optionItems(meta.items, $selectBlckElem);

    setEventHandler(meta, $selectBlckElem, id, 'change');

    $divElem.append($selectBlckElem)


    $element.append($divElem.append(makeElement('div',
      { class: 'error', id: id + '-err' })));


  } else {
    const [id, attr, inputLabel] = initializeElemAttribs(meta, path);

    $element.append(makeElement('label', { for: id }).text(inputLabel));
    const $divElem = makeElement('div');

    const $fieldSetBlockElem = makeElement('div', { class: 'fieldset' });
    inputItems(meta.items, 'radio', id, attr, $fieldSetBlockElem);

    setEventHandler(meta, $fieldSetBlockElem, id, 'change');

    $divElem.append($fieldSetBlockElem);
    $divElem.append(makeElement('div',
      { class: 'error', id: id + '-err' }));

    $element.append($divElem);

  }
}


//map from type to type handling function.  
const FNS = {
  block,
  form,
  header,
  input,
  link,
  multiSelect,
  para,
  segment,
  submit,
  uniSelect,
};

/*************************** Top-Level Code ****************************/

function render(path, $element = $('body')) {
  const meta = access(path);
  if (!meta) {
    $element.append(`<p>Path ${makeId(path)} not found</p>`);
  }
  else {
    const type = getType(meta);
    const fn = FNS[type];
    if (fn) {
      fn(meta, path, $element);
    }
    else {
      $element.append(`<p>type ${type} not supported</p>`);
    }
  }
}

function go() {
  const ref = getRef() || DEFAULT_REF;
  render([ref]);
}

go();

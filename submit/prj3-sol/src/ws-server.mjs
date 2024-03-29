import assert from 'assert';
//import cors from 'cors';
import express from 'express';
import bodyParser from 'body-parser';
import querystring from 'querystring';

import ModelError from './model-error.mjs';

//not all codes necessary
const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const SERVER_ERROR = 500;

const BASE = 'api';
const CARTS = 'carts';
const BOOKS = 'books';
const CART_ID = 'cartId';
const ISBN = 'isbn';

export default function serve(port, meta, model) {
  const app = express();
  app.locals.port = port;
  app.locals.meta = meta;
  app.locals.model = model;
  setupRoutes(app);
  app.listen(port, function () {
    console.log(`listening on port ${port}`);
  });
}

function setupRoutes(app) {
  //app.use(cors());

  //pseudo-handlers used to set up defaults for req
  app.use(bodyParser.json());      //always parse request bodies as JSON
  app.use(reqSelfUrl, reqBaseUrl); //set useful properties in req

  //application routes
  //@TODO: add other application routes
  app.get(`/${BASE}`, doBase(app));
  app.get(`/${BASE}/${BOOKS}`, doGetBooksByQryPrms(app));
  app.get(`/${BASE}/${BOOKS}/:${ISBN}`, doGetBookById(app));
  app.post(`/${BASE}/${CARTS}`, doCreate(app));
  app.route(`/${BASE}/${CARTS}/:${CART_ID}`)
    .get(doGetCartById(app))
    .patch(doUpdate(app));



  //must be last
  app.use(do404(app));
  app.use(doErrors(app));
}

/****************************** Handlers *******************************/

/** Sets selfUrl property on req to complete URL of req,
 *  including query parameters.
 */
function reqSelfUrl(req, res, next) {
  const port = req.app.locals.port;
  req.selfUrl = `${req.protocol}://${req.hostname}:${port}${req.originalUrl}`;
  next();  //absolutely essential
}

/** Sets baseUrl property on req to complete URL of BASE. */
function reqBaseUrl(req, res, next) {
  const port = req.app.locals.port;
  req.baseUrl = `${req.protocol}://${req.hostname}:${port}/${BASE}`;
  next(); //absolutely essential
}

function doBase(app) {
  return function (req, res) {
    try {
      const links = [
        { rel: 'self', name: 'self', href: req.selfUrl, },
        { rel: 'collection', name: 'books', href: req.selfUrl.concat('/books'), },
        { rel: 'collection', name: 'carts', href: req.selfUrl.concat('/carts'), },
        //@TODO add links for book and cart collections
      ];
      res.json({ links });
    }
    catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  };
}


//@TODO: Add handlers for other application routes

//REQUIRED COMMENT
function doGetBookById(app) {
  return errorWrap(async function (req, res) {
    try {
      const isbn = req.params.isbn;
      const results = await app.locals.model.findBooks({ isbn: isbn });
      if (results.length === 0) {
        const message = `no book for isbn ${isbn}`;
        throw [new ModelError('BAD_ID', message, 'isbn'),];
      } else {
        const links = [{ href: req.selfUrl, name: 'self', rel: 'self' },];
        const result = { links: links, result: results[0] };
        res.json(result);
      }
    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}

function doGetBooksByQryPrms(app) {
  return errorWrap(async function (req, res) {
    try {
      const srchTerm = req.query.authorsTitleSearch;
      const _index = parseInt(req.query._index || 0);
      const _count = parseInt(req.query._count || 5);
      const preResults = await app.locals.model.findBooks(
        {
          authorsTitleSearch: srchTerm,
          _count: 3000,
          _index: 0
        });

      const links = [{ href: req.selfUrl, name: 'self', rel: 'self' }];

      const startIndex = _index;
      const endIndex = startIndex + _count - 1;


      if (endIndex > -1 && endIndex <
        preResults.length - 1 &&
        preResults.length > 0) {
        const srchQuery = `?authorsTitleSearch=${srchTerm}`;
        const indexQuery = endIndex > -1 && endIndex < preResults.length ?
          `&_index=${_index + _count}` : '';
        const countQuery = req.query._count ? `&_count=${_count}` : '';
        links.push({
          href: req.baseUrl.concat(`/${BOOKS}`
            + srchQuery
            + indexQuery
            + countQuery),
          name: 'next',
          rel: 'next'
        });
      }


      if (startIndex > 0 && preResults.length > 0) {
        const srchQuery = `?authorsTitleSearch=${srchTerm}`;
        const indexQuery = req.query._index ? `&_index=${_index - _count}` : '';
        const countQuery = req.query._count ? `&_count=${_count}` : '';
        links.push({
          href: req.baseUrl.concat(`/${BOOKS}`
            + srchQuery
            + indexQuery
            + countQuery),
          name: 'prev',
          rel: 'prev'
        });
      }



      const results = await app.locals.model.findBooks(req.query);
      const bookResults = [];
      results.forEach(element => {
        const bookLinks = [{
          href: req.baseUrl.concat(`/${BOOKS}/${element.isbn}`),
          name: 'book',
          rel: 'details',
        }];
        element.links = bookLinks;
        bookResults.push(element);
      });
      const finalResult = { links: links, result: bookResults };

      res.json(finalResult);

    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}

function doGetCartById(app) {
  return errorWrap(async function (req, res) {
    try {
      const cartId = req.params.cartId;
      const results = await app.locals.model.getCart({ cartId: cartId });
      if (results.length === 0) {
        const message = `Cart with cart-id ${cartId} not found`;
        throw {
          status: NOT_FOUND,
          errors: [{ code: 'NOT_FOUND', message, },],
        }
      } else {
        const cartLinks = [{ href: req.selfUrl, name: 'self', rel: 'self' },];

        const lastModified = results['_lastModified'];
        delete results['_lastModified'];
        const booksResults = [];
        for (const sku in results) {
          if (results.hasOwnProperty(sku)) {
            const bookLinks = [{
              href: req.baseUrl.concat(`/${BOOKS}/${sku}`),
              name: 'book',
              rel: 'item',
            }];
            booksResults.push({
              links: bookLinks,
              sku: sku,
              nUnits: results[sku]
            });
          }
        }
        const finalResult = {
          _lastModified: lastModified,
          links: cartLinks,
          result: booksResults,
        };
        res.json(finalResult);
      }
    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped)
    }
  });
}

//REQUIRED COMMENT
function doCreate(app) {
  return errorWrap(async function (req, res) {
    try {
      const inputFields = app.locals.meta.newCart.fields;
      const cartId = await app.locals.model.newCart(inputFields);
      res.append('Location', req.selfUrl.concat(`/${cartId}`));
      res.status(CREATED).end();
    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}

//REQUIRED COMMENT
function doUpdate(app) {
  return errorWrap(async function (req, res) {
    try {
      const patch = Object.assign({}, req.body,);
      patch.cartId = req.params.cartId;
      const results = await app.locals.model.cartItem(patch);
      res.status(NO_CONTENT).end();
    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}

/** Default handler for when there is no route for a particular method
 *  and path.
 */
function do404(app) {
  return async function (req, res) {
    const message = `${req.method} not supported for ${req.originalUrl}`;
    const result = {
      status: NOT_FOUND,
      errors: [{ code: 'NOT_FOUND', message, },],
    };
    res.type('text').
      status(404).
      json(result);
  };
}


/** Ensures a server error results in nice JSON sent back to client
 *  with details logged on console.
 */
function doErrors(app) {
  return async function (err, req, res, next) {
    const result = {
      status: SERVER_ERROR,
      errors: [{ code: 'SERVER_ERROR', message: err.message }],
    };
    res.status(SERVER_ERROR).json(result);
    console.error(err);
  };
}

/** Set up error handling for handler by wrapping it in a 
 *  try-catch with chaining to error handler on error.
 */
function errorWrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    }
    catch (err) {
      next(err);
    }
  };
}


/*************************** Mapping Errors ****************************/

const ERROR_MAP = {
  BAD_ID: NOT_FOUND,
}

/** Map domain/internal errors into suitable HTTP errors.  Return'd
 *  object will have a "status" property corresponding to HTTP status
 *  code and an errors property containing list of error objects
 *  with code, message and name properties.
 */
function mapError(err) {
  const isDomainError =
    (err instanceof Array && err.length > 0 && err[0] instanceof ModelError);
  const status =
    isDomainError ? (ERROR_MAP[err[0].code] || BAD_REQUEST) : SERVER_ERROR;
  const errors =
    isDomainError
      ? err.map(e => ({ code: e.code, message: e.message, name: e.name }))
      : [{ code: 'SERVER_ERROR', message: err.toString(), }];
  if (!isDomainError) console.error(err);
  return { status, errors };
}

/****************************** Utilities ******************************/



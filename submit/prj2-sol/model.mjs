import META from './meta.mjs';
import Validator from './validator.mjs';
import ModelError from './model-error.mjs';

import mongo from 'mongodb';

import assert from 'assert';
import util from 'util';


/** 

All detected errors should be reported by throwing an array of
ModelError objects.  

Errors are of two types:

  + *Local errors* depend only on the field values of the current data
    item.  Local errors are specified and checked using meta.mjs
    and validator.mjs and are not specified below.

  + *Global errors* depend on data items other than the current data
    item.  The comments for the code below document global errors.

Each ModelError must be specified with an error code (defined below)
and an error message which should be as specific as possible.  If the
error is associated with a particular field, then the internal name of
that field should be filled in to the ModelError object.  Note that if
an error message refers to the name of the field, it should do so
using the external name (`label`) of the field.

The codes for the ModelError include the following:

BAD_ACT:
  Action does not correspond to one of the model action routines.

BAD_FIELD:
  An object contains an unknown field name or a forbidden field.

BAD_FIELD_VALUE:
  The value of a field does not meet its specs.

BAD_ID:
  Object not found for specified ID.  Includes an error when some field 
  specifies an id for some other object, but there is no object having
  that ID.

DB:
  Database error

FORM_ERROR:
  Form is invalid.

MISSING_FIELD:
  The value of a required field is not specified.

*/

export default class Model {

  /** Set up properties from props as properties of this. */
  constructor(props) {
    Object.assign(this, props);
  }

  /** Return a new instance of Model set up to use database specified
   *  by dbUrl
   */
  static async make(dbUrl) {
    let client;
    try {
      // Retrieving DB-Name and MongoUrl from the dbUrl
      const [dbName, mongoUrl] =
        [dbUrl.slice(dbUrl.lastIndexOf("\/") + 1),
        dbUrl.slice(0, dbUrl.lastIndexOf("\/"))];

      // Creating the client object after establishing connection to mongo
      client = await mongo.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
      // Creating Database
      const db = client.db(dbName);
      // Collections of Book_Catalog and Shopping_cart
      const bookCatalogColln = db.collection(BOOK_CATALOG_TABLE);
      const shoppingCartColln = db.collection(SHOPPING_CART_TABLE);

      // Updated props object wotj client, db, bookCatalog, shoppingCart
      const props = {
        validator: new Validator(META),
        client: client,
        db: db,
        bookCatalog: bookCatalogColln,
        shoppingCart: shoppingCartColln,
        //@Todo- other props
      };
      const model = new Model(props);
      return model;
    }
    catch (err) {
      const msg = `cannot connect to URL "${dbUrl}": ${err}`;
      throw [new ModelError('DB', msg)];
    }
  }

  /** Release all resources held by this model.  Specifically,
   *  close any database connections.
   */
  async close() {
    // Close connection to mongoDb
    try {
      await this.client.close();
    } catch (error) {
      const msg = `Error while closing connection to \
       DB "${this.db.databaseName}": ${error}`;
      throw [new ModelError('DB', msg)];
    }
  }

  /** Clear out all data stored within this model. */
  async clear() {
    // Clear DB collection contents
    try {
      await this.bookCatalog.deleteMany({});
      await this.shoppingCart.deleteMany({});

    } catch (error) {
      const msg = `Error while clearing the contents \
      in collection ": ${error}`;
      throw [new ModelError('DB-Collection', msg)];
    }
  }

  //Action routines

  /** Create a new cart.  Returns ID of newly created cart.  The
   * returned ID should not be generated by the database; it should
   * also not be easily guessable.
   *
   *  The new cart should have a `_lastModified` field set to the
   *  current Date timestamp.
   */
  async newCart(rawNameValues) {
    const nameValues = this._validate('newCart', rawNameValues);
    const cartId = Math.random().toString();
    //@TODO
    try {

      await this.shoppingCart.insertOne({ cartId: cartId });
    } catch (error) {
      const msg = `Error while adding record to shopping_cart ": ${error}`;
      throw [new ModelError('insert-newCart', msg)];
    }
    return cartId;
  }

  /** Given fields { cartId, sku, nUnits } = rawNameValues, update
   *  number of units for sku to nUnits.  Update `_lastModified` field
   *  of cart to current Date timestamp.
   *
   *  Global Errors:
   *    BAD_ID: cartId does not reference a cart.
   *            sku does not specify the isbn of an existing book.
   */
  async cartItem(rawNameValues) {
    const nameValues = this._validate('cartItem', rawNameValues);
    const sku = nameValues.sku;
    const identifer = {
      cartId: nameValues.cartId
    };
    const lastModified = Object.assign({}, { _lastModified: true });
    const updateFields = Object.assign({}, {
      [sku]: nameValues.nUnits
    });
    let result;

    result = await this.shoppingCart.updateOne(identifer, {

      $set: updateFields,
      $currentDate: lastModified,
    });
    if (result.modifiedCount !== 1) {
      const msg = `unknown sku ${sku}`;
      throw [new ModelError('BAD_ID', msg, 'sku')];

    }
  }

  /** Given fields { cartId } = nameValues, return cart identified by
   *  cartId.  The cart is returned as an object which contains a
   *  mapping from SKU's to *positive* integers (representing the
   *  number of units of the item identified by the SKU contained in
   *  the cart).  Addtionally, it must also have a `_lastModified`
   *  property containing a Date timestamp specifying the last time the
   *  cart was modified.
   *
   *  Globals Errors:
   *    BAD_ID: cartId does not reference a cart.
   */
  async getCart(rawNameValues) {
    const nameValues = this._validate('getCart', rawNameValues);
    //@TODO
    return await this.shoppingCart.find({}).toArray();
  }

  /** Given fields { isbn, title, authors, publisher, year, pages } =
   *  nameValues for a book, add the book to this model.  The isbn
   *  field should uniquely identify the book.  Note that if the book
   *  already exists in this model, then this routine should merely
   *  update the information associated with the book.
   *
   *  Returns the isbn of the added/updated book.
   *
   *  This routine should set a `_lastModified` field in the book to
   *  the current Date timestamp.
   */
  async addBook(rawNameValues) {
    const nameValues = this._validate('addBook', rawNameValues);
    console.log(nameValues);
    //@TODO
  }

  /** Given fields { isbn, authorsTitle, _count=COUNT, _index=0 } =
   *  nameValues, retrieve list of all books with specified isbn (if
   *  any) and the words specified in authorsTitle occurring in either
   *  the book's authors field or the title field.  The retrieved
   *  results are sorted in ascending order by title.  The returned
   *  results have up to _count books starting at index _index in the
   *  retrieved results.  The `_index` and `_count` fields allow
   *  paging through the search results.
   *
   *  Will return [] if no books match the search criteria.
   */
  async findBooks(rawNameValues) {
    const nameValues = this._validate('findBooks', rawNameValues);
    //@TODO
    return [];
  }

  //wrapper around this.validator to verify that no external field
  //is _id which is used by mongo
  _validate(action, rawNameValues) {
    let errs = [];
    let nameValues;
    try {
      nameValues = this.validator.validate(action, rawNameValues);
    }
    catch (err) {
      if (err instanceof Array) { //something we understand
        errs = err;
      }
      else {
        throw err; //not expected, throw upstairs
      }
    }
    if (rawNameValues._id !== undefined) {
      errs.push(new ModelError('BAD_FIELD', '_id field not permitted', '_id'));
    }
    if (errs.length > 0) throw errs;
    return nameValues;
  }


};

//use as second argument to mongo.connect()
const MONGO_CONNECT_OPTIONS = { useUnifiedTopology: true };

//default value for _count in findBooks()
const COUNT = 5;

//define private constants and functions here.
const BOOK_CATALOG_TABLE = 'Book_Catalog';

const SHOPPING_CART_TABLE = 'Shopping_Cart';
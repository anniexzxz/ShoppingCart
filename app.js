const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});

const upload = multer({ storage: storage });

const connection = mysql.createConnection({
    host: 'c237-boss.mysql.database.azure.com',
    user: 'c237boss',
    password: 'c237boss!',
    database: 'c237_024_shoppipipi' //need change to our database name
  });

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, dob, contact, role } = req.body;

    if (!username || !email || !password || !dob || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }
    
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/signup');
    }
    next();
};

// Define routes
app.get('/',  (req, res) => {
    res.render('index', {user: req.session.user} );
});

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
      if (error) throw error;
      res.render('inventory', { products: results, user: req.session.user });
    });
});

app.get('/signup', (req, res) => {
    res.render('signup', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/signup', validateRegistration, (req, res) => {

    const { username, email, password, dob, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, dob, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, dob, contact, role], (err, result) => {
        if (err) {
            throw err;
        }
        console.log(result);
        req.flash('success', 'Sign up successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            throw err;
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0]; 
            req.flash('success', 'Login successful!');
            if(req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});


app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query('SELECT * FROM products WHERE productId = ?', [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            const product = results[0];

            if (product.quantity < quantity){
                req.flash('error', 'Not enough stock available.')
                return res.redirect('/shopping')
            }
            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if product already in cart
            const existingItem = req.session.cart.find(item => item.productId === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    productId: product.productId,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image,
                    description: product.description,
                    url: product.url
                });
            }

            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user });
});

app.post('/cart/delete/:id', (req, res) => {
    const idToDelete = parseInt(req.params.id);  // Make sure it's a number
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(item => item.productId !== idToDelete);
    }
    res.redirect('/cart');
});

app.post('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart;

    if (!cart || cart.length === 0) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/cart');
    }

    function checkStock(index) {
        if (index >= cart.length) {
            return updateStock(0);
        }

        const item = cart[index];
        connection.query('SELECT quantity FROM products WHERE productId = ?', [item.productId], (error, results) => {
            if (error) {
                console.error('Error checking stock:', error);
                return res.status(500).send('Error processing checkout');
            }

            if (!results[0] || results[0].quantity < item.quantity) {
                req.flash('error', `Not enough stock for ${item.productName}.`);
                return res.redirect('/cart');
            }

            checkStock(index + 1);
        });
    }

    function updateStock(index) {
        if (index >= cart.length) {
            req.session.cart = [];
            req.flash('success', 'Checkout successful! Thank you for your purchase.');
            return res.redirect('/shopping');
        }

        const item = cart[index];
        connection.query('UPDATE products SET quantity = quantity - ? WHERE productId = ?', [item.quantity, item.productId], (error) => {
            if (error) {
                console.error('Error updating stock:', error);
                return res.status(500).send('Error processing checkout');
            }

            updateStock(index + 1);
        });
    }

    checkStock(0);
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/product/:id', checkAuthenticated, (req, res) => {
  // Extract the product ID from the request parameters
  const productId = req.params.id;

  // Fetch data from MySQL based on the product ID
  connection.query('SELECT * FROM products WHERE productId = ?', [productId], (error, results) => {
      if (error) throw error;

      // Check if any product with the given ID was found
      if (results.length > 0) {
          // Render HTML page with the product data
          res.render('product', { product: results[0], user: req.session.user  });
      } else {
          // If no product with the given ID was found, render a 404 page or handle it accordingly
          res.status(404).send('Product not found');
      }
  });
});

// GET route to render the Add Product form
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
  });

  // POST route to handle form submission
  app.post('/addProduct', upload.single('image'), (req, res) => {
    const { name, quantity, price } = req.body;
    const image = req.file ? req.file.filename : null;
  
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    connection.query(sql, [name, quantity, price, image], (error, results) => {
      if (error) {
        console.error("Error adding product:", error);
        res.status(500).send('Error adding product');
      } else {
        res.redirect('/inventory');
      }
    });
  });


app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE productId = ?';

    // Fetch data from MySQL based on the product ID
    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;

        // Check if any product with the given ID was found
        if (results.length > 0) {
            // Render HTML page with the product data
            res.render('updateProduct', { product: results[0] });
        } else {
            // If no product with the given ID was found, render a 404 page or handle it accordingly
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const productId = req.params.id;
    // Extract product data from the request body
    const { name, quantity, price } = req.body;
    let image  = req.body.currentImage; //retrieve current image filename
    if (req.file) { //if new image is uploaded
        image = req.file.filename; // set image to be new image filename
    } 

    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image = ?, description =?, url= ? WHERE productId = ?';
    // Insert the new product into the database
    connection.query(sql, [name, quantity, price, image, description, url, productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', (req, res) => {
    const productId = req.params.id;
    connection.query('DELETE FROM products WHERE productId = ?', [productId], (error, results) => {
    if (error) {
        // Handle any error that occurs during the database operation
        console.error("Error deleting product:", error);
        res.status(500).send('Error deleting product');
    } else {
        // Send a success response
        res.redirect('/inventory');
    }
    });
});

app.get('/shopping', checkAuthenticated, (req, res) => {
    const search = req.query.search || '';  // default to empty string if undefined

    let sql = 'SELECT * FROM products';
    let params = [];

    if (search) {
        sql += ' WHERE productName LIKE ?';
        params.push(`%${search}%`);
    }

    connection.query(sql, params, (error, results) => {
        if (error) throw error;
        // Pass search to EJS to prevent 'search is not defined' error
        res.render('shopping', { user: req.session.user, products: results, search });
    });
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


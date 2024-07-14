const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 5000;
require("dotenv").config();
const stripe = require("stripe")(`${process.env.STRIPE_SECRET_KEY}`);
var jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
app.use(express.json());
app.use(cors({
  origin: [ "http://localhost:5173", "https://bistro-boss-6a1a5.web.app" ]}));

//mongoDb Start

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zmeeuxc.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    //oparation Start here

    const menuCollecton = client.db("bistro_boss_Db").collection("menu");
    const reviewsCollecton = client.db("bistro_boss_Db").collection("reviews");
    const cartsCollecton = client.db("bistro_boss_Db").collection("carts");
    const usersCollecton = client.db("bistro_boss_Db").collection("users");
    const paymentsCollecton = client
      .db("bistro_boss_Db")
      .collection("payments");

    // our custome middleware for verify token
    const verifyToken = async (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorize Access" });
      }

      const token = req.headers.authorization?.split(" ")[1];
      // console.log("inside verify token", token);

      if (!token) {
        return res.status(401).send({ message: "Unauthorize Access" });
      }

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "Unauthorize Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify admin after verify token releted middleware.
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollecton.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden" });
      }

      next();
    };

    const userVerify = async (req, res, next) => {
      if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //jwt releted api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    //payment intent api post
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      // console.log(amount, "total amount of cart product");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // payment history  laod
    app.get("/payments/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const result = await paymentsCollecton.find(query).toArray();
      res.send(result);
    });

    //payment or order releted api
    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentsCollecton.insertOne(payment);

      // console.log('payment history', payment)

      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };

      const deleteResult = await cartsCollecton.deleteMany(query);

      res.send({ paymentResult, deleteResult });
    });

    // stats or site analytics releted api
    app.get("/admin-stats", async (req, res) => {
      const users = await usersCollecton.estimatedDocumentCount();
      const menuItems = await menuCollecton.estimatedDocumentCount();
      const orders = await paymentsCollecton.estimatedDocumentCount();

      //this is not best way
      // const payment = await paymentsCollecton.find().toArray();

      // const revinue = payment.reduce((total, item)=> total + item.price, 0);

      // better way
      const revinueResult = await paymentsCollecton
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevinue: { $sum: "$price" },
            },
          },
        ])
        .toArray();

      const totalRevinue =
        revinueResult.length > 0 ? revinueResult[0].totalRevinue : 0;

      res.send({ users, menuItems, orders, revinue: totalRevinue });
    });

    // get menu collection
    app.get("/menu", async (req, res) => {
      const result = await menuCollecton.find().toArray();
      res.send(result);
    });

    // add item or menu adding post
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollecton.insertOne(item);
      res.send(result);
    });

    // delete menu item
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollecton.deleteOne(query);
      res.send(result);
    });

    //get single menu item
    app.get("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollecton.findOne(query);
      res.send(result);
    });

    // update menu item with patch
    app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const item = req.body;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: item.name,
          price: item.price,
          image: item?.image,
          category: item.category,
          recipe: item.recipe,
        },
      };
      const result = await menuCollecton.updateOne(filter, updateDoc);
      res.send(result);
    });

    //get reviews Collection
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollecton.find().toArray();
      res.send(result);
    });

    // cart item get
    app.get("/carts", async (req, res) => {
      const email = req?.query?.email;
      const query = { email: email };

      const result = await cartsCollecton.find(query).toArray();
      res.send(result);
    });

    //cart item post
    app.post("/carts", verifyToken, async (req, res) => {
      const cartItem = req.body;
      const result = await cartsCollecton.insertOne(cartItem);

      res.send(result);
    });

    // cart item delete
    app.delete("/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollecton.deleteOne(query);
      res.send(result);
    });

    //user releted api ---------------
    //get tolal users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      //   console.log('hello Get Users')
      const result = await usersCollecton.find().toArray();
      res.send(result);
    });
    // user information post
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollecton.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollecton.insertOne(user);
      res.send(result);
    });

    //user deleted
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollecton.deleteOne(query);
      res.send(result);
    });

    // admin releted api patch
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollecton.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    //admin releted api
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await usersCollecton.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }

      res.send({ admin });
    });

    //order status
    // --------------------
    //NoN Efficient way
    //______________________

    /* 

    1. load all the payment
    2. for every menuItemsIds (which is an array), go find the item from menu collenction
    3. for every item in the menu collection that you found from a payment entry(document).
    
    */

    // right way order status

    //using aggregate pipeline
    app.get("/order-stats",verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentsCollecton
        .aggregate([
          {
            $unwind: "$menuIds",
          },
          {
            $addFields: {
              menuIds: { $toObjectId: "$menuIds" },
            },
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              totalQuantity: { $sum: 1 },
              totalRevinue: { $sum: "$menuItems.price" },
            }
          },
          {
            $project : {
              _id : 0,
              category : "$_id",
              totalQuantity : 1,
              totalRevinue : 1
            }
          }
         
        ])
        .toArray();

      res.send(result);
    });

    //Oparation End Here

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

//mongoDb End

app.get("/", (req, res) => {
  res.send("Bistro Boss is Running");
});

app.listen(port, () => {
  console.log(`Bistro Boss Server is Running on PORT : ${port}`);
});

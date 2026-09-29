
function Library() {


    return(
        <>
            // Site header
            {/* <Header /> */}
            // Map Collection to grid
            <Collection />
            // map documents to Document Views
            // Graph View
            // Grid view
            {/* <SingleDocumentView /> */}
        </>
    );
}

function Header() {
    return(
        <></>
    );
}

function SingleDocumentView() {

    return(
        // doc metadata
        //pdf reader
        // comments
        <></>
    );

}

// let collectionId: string;

type Collection = {
    // uuid?
    collectionId: string;
    contents: Document[];
}

// functional component in preact
// writing a method to add documents to a collection (from collection, pick documents)
// so a Collection component has a method for add to? takes documents

//under Library, getting passed props/context (the actual documents, as arg for addtoCollection)
function Collection() {

    //hooks to hold state? or bigger state mgmt like context?

    function addToCollection(documentIds: string[]) {
        let collectionName = prompt("Collection name");
        //take an array of document Ids selected by user 
            // they will be able to select multiple, if not now
        // call back to db with the ids, to get the metadata?
        // or send the full Document object in an array?
        
    }

    return(
        <>
            <SingleDocumentView />
        </>
    );
}

import { render } from "preact";
render(<Library />, document.getElementById("app")!);
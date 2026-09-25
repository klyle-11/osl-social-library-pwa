
function Library() {
    return(
        <>
            <Collection />
        </>
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

    }


    return(

    );
}

